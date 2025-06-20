// lib/foundation-stack/foundation-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SECRETS_MANAGER_PARSE_OWNED_SECRET_NAME } from 'aws-cdk-lib/cx-api';

interface DataProcessingStackProps extends cdk.StackProps {
    vpc: ec2.IVpc;
    sqlServerSecurityGroup: ec2.ISecurityGroup;
    sqlServerInstance: ec2.Instance;
    bronzeBucket: s3.Bucket;
    silverBucket: s3.Bucket;
    goldBucket: s3.Bucket;
    jobMetricsTable: cdk.aws_dynamodb.Table;
  }

export class DataProcessingStack extends cdk.Stack {
  public goldCrawler: glue.CfnCrawler;
  public extractCarGlueJob :  glue.CfnJob;
  public extractDriverGlueJob :  glue.CfnJob;
  public extractPolicyGlueJob :  glue.CfnJob;
  public extractInsuranceRequestGlueJob :  glue.CfnJob;
  public bronzeCrawler: glue.CfnCrawler;
  public aggregatePreprocessGlueJob : glue.CfnJob;
  public glueDatabase : glue.CfnDatabase
  public checkProcessRecordLambda: lambda.Function

  constructor(scope: Construct, id: string, props: DataProcessingStackProps) {
    super(scope, id, props);

    const sqlservername = process.env["SQL_SERVER_NAME"]
    const sqlserveruser = process.env["SQL_SERVER_USER"]
    const sqlserverpassword = process.env["SQL_SERVER_PASSWORD"]
    const hostname = props.sqlServerInstance.instancePrivateDnsName
    const jdbcurl = 'jdbc:sqlserver://'+hostname+'\\'+sqlservername+':1433;databaseName=InsuranceDB'
    

    
    // Get the private subnet where SQL Server is deployed
    const privateSubnets = props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }).subnets;
  
      // Use the first private subnet (you might want to adjust this logic)
    const sqlServerSubnet = privateSubnets[0];

    

    // Create Security Group for Glue Connection
    const glueSecurityGroup = new ec2.SecurityGroup(this, 'GlueConnectionSG', {
      vpc: props.vpc,
      description: 'Security Group for Glue Connection',
      allowAllOutbound: true,
    });

    // Create IAM role for the gold crawler
    const goldCrawlerRole = new iam.Role(this, 'GoldCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ]
    });

    // Grant permissions to access the gold bucket
    props.goldBucket.grantRead(goldCrawlerRole);

    // Creating the Glue Database for gold layer
    const goldDatabase = new glue.CfnDatabase(this, 'InsuranceGoldDatabase', {
        catalogId: this.account,
        databaseInput: {
            name: 'insurance_gold_db',
            description: 'Database for insurance data in gold layer'
        }
    });

    // Create Gold Crawler
    this.goldCrawler = new glue.CfnCrawler(this, 'GoldCrawler', {
      name: 'insurance-gold-crawler',
      role: goldCrawlerRole.roleArn,
      databaseName: goldDatabase.ref,
      description: 'Crawler for insurance data in gold layer',
      targets: {
        s3Targets: [
          {
            path: `s3://${props.goldBucket.bucketName}/`
          }
        ]
      },
      tablePrefix: 'gold_',
      schemaChangePolicy: {
        updateBehavior: 'LOG',
        deleteBehavior: 'LOG'
      },
      recrawlPolicy: {
        recrawlBehavior: 'CRAWL_NEW_FOLDERS_ONLY'
      },
      configuration: JSON.stringify({
        Version: 1.0,
        CrawlerOutput: {
          Partitions: { AddOrUpdateBehavior: 'InheritFromTable' }
        },
        Grouping: {
          TableGroupingPolicy: 'CombineCompatibleSchemas' // Multiple parquet files in Gold bucket have same schema
        }
      })
    });

    // Add self-referencing rule to allow all TCP traffic within the same security group
    glueSecurityGroup.connections.allowInternally(
        ec2.Port.allTcp(),
        'Allow all TCP traffic within the same security group'
    );

    // Add VPC Endpoints for Glue
    new ec2.InterfaceVpcEndpoint(this, 'GlueEndpoint', {
        vpc: props.vpc,
        service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.glue`),
        privateDnsEnabled: false,
        subnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
        securityGroups: [glueSecurityGroup]
        
    });  

    // Create an S3 bucket for Glue scripts and data
    const glueBucket = new s3.Bucket(this, 'data-pipeline-script-bkt', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Create a secret for SQL Server credentials
    const sqlServerSecret = new secretsmanager.Secret(this, 'SQLServerSecret', {
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        username: sqlserveruser,
        password: sqlserverpassword
      })),
      description: 'SQL Server credentials for Glue connection'
    });

    // Create IAM role for general Glue jobs
    const glueJobRole = new iam.Role(this, 'GlueJobRole', {
        assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
        ]
      });
    
    // Add permissions to access S3 bucket for both roles
    glueBucket.grantReadWrite(glueJobRole);  
    props.bronzeBucket.grantReadWrite(glueJobRole);
    props.silverBucket.grantReadWrite(glueJobRole);
    props.goldBucket.grantReadWrite(glueJobRole);
    // add permission to put and get in the job metrics table
    props.jobMetricsTable.grantReadWriteData(glueJobRole);    

    // Add permissions to access Secrets Manager
    sqlServerSecret.grantRead(glueJobRole);

    // Create Glue Connection
    const glueConnection = new glue.CfnConnection(this, 'SQLServerConnection', {
      catalogId: this.account,
      connectionInput: {
        name: 'sql-server-connection',
        connectionType: 'JDBC',
        connectionProperties: {
          JDBC_CONNECTION_URL: jdbcurl,
          JDBC_ENFORCE_SSL: 'false',
          SECRET_ID: sqlServerSecret.secretName
        },
        physicalConnectionRequirements: {
          availabilityZone: sqlServerSubnet.availabilityZone, // This is mandatory field
          securityGroupIdList: [glueSecurityGroup.securityGroupId], // Replace with your security group
          subnetId: sqlServerSubnet.subnetId, // Replace with your subnet ID

        }
      }
    });

    // Make sure the connection depends on the secret
    glueConnection.node.addDependency(sqlServerSecret);

    // Upload Glue job script to S3
    new s3deploy.BucketDeployment(this, 'glue-bucket-deploy', {
        sources: [s3deploy.Source.asset('./scripts/glue-scripts')],
        destinationBucket: glueBucket,
        destinationKeyPrefix: 'scripts'
    });

    /////////////////////////////////////////////////////////////////////

    // Create Glue job for Car data extraction
    this.extractCarGlueJob = new glue.CfnJob(this, 'CarTableExtractJob', {
      name: 'sql-server-car-extract-job',
      role: glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${glueBucket.bucketName}/scripts/sql_data_extract_from_table.py`
      },
      workerType: 'G.1X',
      numberOfWorkers: 10,
      executionProperty: {
        maxConcurrentRuns: 1
      },
      defaultArguments: {
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--enable-auto-scaling': 'true',
        '--enable-job-insights': 'true',
        '--spark-event-logs-path': `s3://${glueBucket.bucketName}/spark-logs/`,
        '--enable-continuous-cloudwatch-log': 'true',
        '--job-language': 'python',
        '--TempDir': `s3://${glueBucket.bucketName}/temporary/`,
        '--CONNECTION_NAME': glueConnection.ref,
        '--S3_OUTPUT_PATH': `s3://${props.bronzeBucket.bucketName}/`,
        '--TABLE_NAME': `Sales.Car`,
        '--HASH_COL_NAME': `CarID`,
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-job-bookmarks': 'true',
        '--METRICS_TABLE_NAME': props.jobMetricsTable.tableName 
      },
      glueVersion: '4.0',
      maxRetries: 0,
      connections: {
        connections: ['sql-server-connection'] 
      },
      timeout: 2880,
    });
    // Add dependency to ensure connection is created before the job
    this.extractCarGlueJob.addDependency(glueConnection);

    // Create Glue job for Driver data extraction
    this.extractDriverGlueJob = new glue.CfnJob(this, 'DriverTableExtractJob', {
      name: 'sql-server-driver-extract-job',
      role: glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${glueBucket.bucketName}/scripts/sql_data_extract_from_table.py`
      },
      workerType: 'G.1X',
      numberOfWorkers: 10,
      executionProperty: {
        maxConcurrentRuns: 1
      },
      defaultArguments: {
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--enable-auto-scaling': 'true',
        '--enable-job-insights': 'true',
        '--spark-event-logs-path': `s3://${glueBucket.bucketName}/spark-logs/`,
        '--enable-continuous-cloudwatch-log': 'true',
        '--job-language': 'python',
        '--TempDir': `s3://${glueBucket.bucketName}/temporary/`,
        '--CONNECTION_NAME': glueConnection.ref,
        '--S3_OUTPUT_PATH': `s3://${props.bronzeBucket.bucketName}/`,
        // '--TABLE_LIST': `Sales.Car,Sales.Driver,Sales.Policy,Sales.InsuranceRequest`
        '--TABLE_NAME': `Sales.Driver`,
        '--HASH_COL_NAME': `DriverID`,
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-job-bookmarks': 'true',
        '--METRICS_TABLE_NAME': props.jobMetricsTable.tableName
      },
      glueVersion: '4.0',
      maxRetries: 0,
      connections: {
        connections: ['sql-server-connection'] 
      },
      timeout: 2880
    });
    // Add dependency to ensure connection is created before the job
    this.extractDriverGlueJob.addDependency(glueConnection);

    // Create Glue job for Policy data extraction
    this.extractPolicyGlueJob = new glue.CfnJob(this, 'PolicyTableExtractJob', {
      name: 'sql-server-policy-extract-job',
      role: glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${glueBucket.bucketName}/scripts/sql_data_extract_from_table.py`
      },
      workerType: 'G.1X',
      numberOfWorkers: 10,
      executionProperty: {
        maxConcurrentRuns: 1
      },
      defaultArguments: {
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--enable-auto-scaling': 'true',
        '--enable-job-insights': 'true',
        '--spark-event-logs-path': `s3://${glueBucket.bucketName}/spark-logs/`,
        '--enable-continuous-cloudwatch-log': 'true',
        '--job-language': 'python',
        '--TempDir': `s3://${glueBucket.bucketName}/temporary/`,
        '--CONNECTION_NAME': glueConnection.ref,
        '--S3_OUTPUT_PATH': `s3://${props.bronzeBucket.bucketName}/`,
        // '--TABLE_LIST': `Sales.Car,Sales.Driver,Sales.Policy,Sales.InsuranceRequest`
        '--TABLE_NAME': `Sales.Policy`,
        '--HASH_COL_NAME': `PolicyID`,
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-job-bookmarks': 'true',
        '--METRICS_TABLE_NAME': props.jobMetricsTable.tableName
      },
      glueVersion: '4.0',
      maxRetries: 0,
      connections: {
        connections: ['sql-server-connection'] 
      },
      timeout: 2880
    });
    // Add dependency to ensure connection is created before the job
    this.extractPolicyGlueJob.addDependency(glueConnection);

    // Create Glue job for Insurance Request data extraction
    this.extractInsuranceRequestGlueJob = new glue.CfnJob(this, 'InsuranceRequestTableExtractJob', {
      name: 'sql-server-insurance-request-extract-job',
      role: glueJobRole.roleArn,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${glueBucket.bucketName}/scripts/sql_data_extract_from_table.py`
      },
      workerType: 'G.1X',
      numberOfWorkers: 10,
      executionProperty: {
        maxConcurrentRuns: 1
      },
      defaultArguments: {
        '--enable-metrics': 'true',
        '--enable-spark-ui': 'true',
        '--enable-auto-scaling': 'true',
        '--enable-job-insights': 'true',
        '--spark-event-logs-path': `s3://${glueBucket.bucketName}/spark-logs/`,
        '--enable-continuous-cloudwatch-log': 'true',
        '--job-language': 'python',
        '--TempDir': `s3://${glueBucket.bucketName}/temporary/`,
        '--CONNECTION_NAME': glueConnection.ref,
        '--S3_OUTPUT_PATH': `s3://${props.bronzeBucket.bucketName}/`,
        // '--TABLE_LIST': `Sales.Car,Sales.Driver,Sales.Policy,Sales.InsuranceRequest`
        '--TABLE_NAME': `Sales.InsuranceRequest`,
        '--HASH_COL_NAME': `RequestID`,
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-job-bookmarks': 'true',
        '--METRICS_TABLE_NAME': props.jobMetricsTable.tableName
      },
      glueVersion: '4.0',
      maxRetries: 0,
      connections: {
        connections: ['sql-server-connection'] 
      },
      timeout: 2880
    });
    // Add dependency to ensure connection is created before the job
    this.extractInsuranceRequestGlueJob.addDependency(glueConnection);

   //////////////////////////////////////////////////////////////////////// 
    // Creating the Glue Database insurance_bronze_db
    this.glueDatabase = new glue.CfnDatabase(this, 'InsuranceGlueDatabase', {
        catalogId: this.account,
        databaseInput: {
        name: 'insurance_bronze_db',
        description: 'Database for insurance data in bronze layer'
        }
    });
  
    // Create IAM role for the crawler
    const crawlerRole = new iam.Role(this, 'GlueCrawlerRole', {
        assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
        managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
        ]
    });
    
    // Add S3 read permissions to the crawler role
    props.bronzeBucket.grantRead(crawlerRole);
    
    // Create the Glue Crawler
    this.bronzeCrawler = new glue.CfnCrawler(this, 'BronzeLayerCrawler', {
        name: 'insurance-bronze-crawler',
        role: crawlerRole.roleArn,
        databaseName: this.glueDatabase.ref,
        description: 'Crawler for insurance data in bronze layer',
        targets: {
        s3Targets: [
            {
            path: `s3://${props.bronzeBucket.bucketName}/`
            }
        ]
        },
        tablePrefix: 'ins_', // This will prefix all table names with 'ins_'
        schemaChangePolicy: {
          updateBehavior: 'LOG',
          deleteBehavior: 'LOG'
        },
        recrawlPolicy: {
          recrawlBehavior: 'CRAWL_NEW_FOLDERS_ONLY'
        },
        configuration: JSON.stringify({
          Version: 1.0,
          CrawlerOutput: {
              Partitions: { AddOrUpdateBehavior: 'InheritFromTable' }
          }
        })
    });

    // Add dependency to ensure database is created before crawler
    this.bronzeCrawler.addDependency(this.glueDatabase);


     // Create specific IAM role for aggregate preprocess Glue job
     const aggregatePreprocessGlueRole = new iam.Role(this, 'AggregatePreprocessGlueRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ],
      inlinePolicies: {
        AthenaAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'athena:StartQueryExecution',
                'athena:GetQueryExecution',
                'athena:GetQueryResults'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Grant necessary bucket permissions to aggregatePreprocessGlueRole
    glueBucket.grantReadWrite(aggregatePreprocessGlueRole);
    props.bronzeBucket.grantReadWrite(aggregatePreprocessGlueRole);
    props.silverBucket.grantReadWrite(aggregatePreprocessGlueRole);
    props.goldBucket.grantReadWrite(aggregatePreprocessGlueRole);
    props.jobMetricsTable.grantReadWriteData(aggregatePreprocessGlueRole);

    // Create Glue job for pre-processing the data by aggregation
     this.aggregatePreprocessGlueJob = new glue.CfnJob(this, 'AggregatePreProcessJob', {
        name: 'aggregate-pre-process-job',
        role: aggregatePreprocessGlueRole.roleArn,
        command: {
          name: 'glueetl',
          pythonVersion: '3',
          scriptLocation: `s3://${glueBucket.bucketName}/scripts/aggregate-pre-process.py`
        },
        defaultArguments: {
          '--enable-metrics': 'true',
          '--enable-spark-ui': 'true',
          '--spark-event-logs-path': `s3://${glueBucket.bucketName}/spark-logs/`,
          '--enable-job-insights': 'true',
          '--enable-continuous-cloudwatch-log': 'true',
          '--job-language': 'python',
          '--TempDir': `s3://${glueBucket.bucketName}/temporary/`,
          '--BUCKET_NAME': `${props.silverBucket.bucketName}`,
          '--CATALOG_DB': `${this.glueDatabase.ref}`,
          '--METRICS_TABLE_NAME': props.jobMetricsTable.tableName
        },
        glueVersion: '4.0',
        maxRetries: 0,
        timeout: 2880,
        numberOfWorkers: 5,
        executionProperty: {
          maxConcurrentRuns: 1
        },
        workerType: 'G.1X'
    });
  
    // Create a lambda function using the check-process-record.py fine in the glueBucket give necessary permissions to the lambda function role
    this.checkProcessRecordLambda = new lambda.Function(this, 'CheckProcessRecordLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'check_process_record.handler',
      code: lambda.Code.fromAsset('././scripts/check-process-record'),
      environment: {
        METRICS_TABLE_NAME: props.jobMetricsTable.tableName
      },
      role: new iam.Role(this, 'CheckProcessRecordLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        ],
        inlinePolicies: {
          GlueAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: [
                  'glue:GetJob',
                  'glue:GetJobRun',
                  'glue:GetJobRuns'
                ],
                resources: ['*']
              }),
              new iam.PolicyStatement({
                actions: [
                  'dynamodb:GetItem',
                  'dynamodb:Query',
                  'dynamodb:Scan'
                ],
                resources: [props.jobMetricsTable.tableArn]
              })
            ]
          })
        }
      })
    });

        // Add CloudWatch Logs permissions
    this.checkProcessRecordLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );

    // Add permissions to access Glue metrics
    this.checkProcessRecordLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudwatch:GetMetricData',
          'cloudwatch:GetMetricStatistics'
        ],
        resources: ['*']
      })
    );
    
    // Outputs
    new cdk.CfnOutput(this, 'GlueBucketName', {
      value: glueBucket.bucketName,
      description: 'Name of the S3 bucket for Glue assets'
    });

    new cdk.CfnOutput(this, 'GlueConnectionName', {
      value: glueConnection.ref,
      description: 'Name of the Glue JDBC connection'
    });

    new cdk.CfnOutput(this, 'CarExtractGlueJobName', {
      value: this.extractCarGlueJob.ref,
      description: 'Name of the Car Extract Glue ETL job'
    });
    new cdk.CfnOutput(this, 'DriverExtractGlueJobName', {
      value: this.extractDriverGlueJob.ref,
      description: 'Name of the Driver Extract Glue ETL job'
    });
    new cdk.CfnOutput(this, 'PolicyExtractGlueJobName', {
      value: this.extractPolicyGlueJob.ref,
      description: 'Name of the Policy Extract Glue ETL job'
    });
    new cdk.CfnOutput(this, 'InsuranceRequestExtractGlueJobName', {
      value: this.extractInsuranceRequestGlueJob.ref,
      description: 'Name of the Glue ETL job'
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
        value: this.glueDatabase.ref,
        description: 'Glue Database Name'
    });
    
    new cdk.CfnOutput(this, 'GlueCrawlerName', {
        value: this.bronzeCrawler.ref,
        description: 'Glue Crawler Name'
    });
    
    new cdk.CfnOutput(this, 'BronzeBucketName', {
        value: props.bronzeBucket.bucketName,
        description: 'Bronze Layer S3 Bucket Name'
    });
  }
}
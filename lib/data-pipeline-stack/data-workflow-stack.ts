import * as cdk from 'aws-cdk-lib';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

interface DataWorkflowStackProps extends cdk.StackProps {
  extractCarGlueJob: glue.CfnJob;
  extractDriverGlueJob: glue.CfnJob;
  extractPolicyGlueJob: glue.CfnJob;
  extractInsuranceRequestGlueJob: glue.CfnJob;
  bronzeCrawler: glue.CfnCrawler;
  aggregatePreprocessGlueJob: glue.CfnJob;
  goldCrawler: glue.CfnCrawler;
  ruleEngineClientFunction: lambda.Function;
  silverBucket: s3.Bucket;
  glueDatabase: glue.CfnDatabase;
  checkProcessRecordLambda: lambda.Function;
  jobMetricsTable: cdk.aws_dynamodb.Table;
}

export class DataWorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataWorkflowStackProps) {
    super(scope, id, props);

    // SNS Topic for email notifications
    const topic = new sns.Topic(this, 'WorkflowCompletionTopic',{
      enforceSSL: true,
      topicName: 'WorkflowCompletionTopic'
    });

    // Add explicit policy to enforce SSL
    const topicPolicy = new sns.TopicPolicy(this, 'WorkflowCompletionTopicPolicy', {
      topics: [topic],
    });

    topicPolicy.document.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
        conditions: {
          'Bool': {
            'aws:SecureTransport': 'false'
          }
        }
      })
    );

    topic.addSubscription(new snsSubscriptions.EmailSubscription(process.env.NOTIFICATION_EMAIL || ''));

    // Create IAM role for Step Functions
    const stepFunctionRole = new iam.Role(this, 'DataProcessingWorkflowRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });

    // Add permissions for Glue job execution
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:StartJobRun',
        'glue:GetJobRun',
        'glue:GetJobRuns',
        'glue:BatchStopJobRun'
      ],
      resources: [`arn:aws:glue:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:job/*`]
    }));

    // Add permissions for .sync service integration
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartSyncExecution',
        'states:StartExecution'
      ],
      resources: ['*']
    }));

    // Add CloudWatch Logs permissions
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogDelivery',
        'logs:GetLogDelivery',
        'logs:UpdateLogDelivery',
        'logs:DeleteLogDelivery',
        'logs:ListLogDeliveries',
        'logs:PutResourcePolicy',
        'logs:DescribeResourcePolicies',
        'logs:DescribeLogGroups'
      ],
      resources: ['*']
    }));

    // Add Glue Crawler permissions
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:StartCrawler',
        'glue:GetCrawler'
      ],
      resources: [`arn:aws:glue:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:crawler/*`]
    }));

    // Add SNS permissions for notifications
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction'
      ],
      resources: [
        props.ruleEngineClientFunction.functionArn,
        props.checkProcessRecordLambda.functionArn
      ]
    }));

    // Add lamda invoke permissions 
    stepFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:Publish'
      ],
      resources: [topic.topicArn]
    }));

    props.silverBucket.grantReadWrite(stepFunctionRole)

    // Create state machine definition
    const machineDefinition = {
      StartAt: 'Generate Workflow ID',
      States: {
        'Generate Workflow ID': {
          Type: 'Pass',
          Parameters: {
            'workflowId.$': '$$.Execution.Name',
            'timestamp.$': '$$.State.EnteredTime'
          },
          Next: 'Extract Data'
        },
      'Extract Data': {
          Type: 'Parallel',
          InputPath: '$',
          ResultPath: '$.extractionResults',
          Branches: [
            {
              StartAt: 'Extract Car Data',
              States: {
                'Extract Car Data': {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::glue:startJobRun.sync',
                  Parameters: {
                    JobName: props.extractCarGlueJob.ref,
                    Arguments: {
                      "--partition_key.$": "States.Format('{}-car', $.workflowId)"
                    }
                  },
                  End: true
                }
              }
            },
            {
              StartAt: 'Extract Driver Data',
              States: {
                'Extract Driver Data': {
                  Type: 'Task', 
                  Resource: 'arn:aws:states:::glue:startJobRun.sync',
                  Parameters: {
                    JobName: props.extractDriverGlueJob.ref,
                    Arguments: {
                      "--partition_key.$": "States.Format('{}-driver', $.workflowId)"
                    }
                  },
                  End: true
                }
              }
            },
            {
              StartAt: 'Extract Policy Data',
              States: {
                'Extract Policy Data': {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::glue:startJobRun.sync', 
                  Parameters: {
                    JobName: props.extractPolicyGlueJob.ref,
                    Arguments: {
                      "--partition_key.$": "States.Format('{}-policy', $.workflowId)"
                    }
                  },
                  End: true
                }
              }
            },
            {
              StartAt: 'Extract Insurance Request Data',
              States: {
                'Extract Insurance Request Data': {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::glue:startJobRun.sync',
                  Parameters: {
                    JobName: props.extractInsuranceRequestGlueJob.ref,
                    Arguments: {
                      "--partition_key.$": "States.Format('{}-insurance', $.workflowId)"
                    }
                  },
                  End: true
                }
              }
            }
          ],
          Next: 'Check Process Record'
        },
        'Check Process Record': {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: props.checkProcessRecordLambda.functionArn,
            Payload: {
              "Input.$": "$",
              "partition_keys.$": "States.Array(States.Format('{}-car', $.workflowId), States.Format('{}-policy', $.workflowId), States.Format('{}-insurance', $.workflowId), States.Format('{}-driver', $.workflowId))"
            }
          },
          ResultPath: "$.CheckProcessResult",
          Next: 'Evaluate Process Records'
        },
        'Evaluate Process Records': {
          Type: 'Choice',
          Choices: [
            {
              Variable: "$.CheckProcessResult.Payload.processed_records",
              NumericGreaterThan: 0,
              Next: "Start Bronze Crawler"
            }
          ],
          Default: 'Send Completion Notification'
        } ,               
        'Start Bronze Crawler': {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:glue:startCrawler',
          Parameters: {
            Name: props.bronzeCrawler.ref
          },
          ResultPath: "$.BronzeCrawler",
          Next: 'Get Bronze Crawler State'
        },
        'Get Bronze Crawler State': {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:glue:getCrawler',
          Parameters: {
            Name: props.bronzeCrawler.ref
          },
          ResultPath: "$.BronzeCrawler",
          Next: 'Check Bronze Crawler State'
        },
        'Check Bronze Crawler State': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.BronzeCrawler.Crawler.State',
              StringEquals: 'RUNNING',
              Next: 'Wait Bronze Crawler'
            }
          ],
          Default: 'Format Timestamp'
        },
        'Wait Bronze Crawler': {
          Type: 'Wait',
          Seconds: 5,
          Next: 'Get Bronze Crawler State'
        },
        'Format Timestamp': {
          Type: 'Pass',
          Parameters: {
            'timestamp.$': '$$.State.EnteredTime',
            'datePart.$': 'States.ArrayGetItem(States.StringSplit($$.State.EnteredTime, \'T\'), 0)',
            'timePart.$': 'States.ArrayGetItem(States.StringSplit($$.State.EnteredTime,\'T\'), 1)'
          },
          ResultPath: "$.formatTimestamp",
          Next: 'Format Path'
        },
        'Format Path': {
          Type: 'Pass',
          Parameters: {
            'bucketName': props.silverBucket.bucketName,
            //'keyName': 'athena_aggr_data',
            'datePath': {
              'year.$': 'States.ArrayGetItem(States.StringSplit($.formatTimestamp.datePart, \'-\'), 0)',
              'month.$': 'States.ArrayGetItem(States.StringSplit($.formatTimestamp.datePart, \'-\'), 1)',
              'day.$': 'States.ArrayGetItem(States.StringSplit($.formatTimestamp.datePart, \'-\'), 2)',
              'hour.$': 'States.ArrayGetItem(States.StringSplit($.formatTimestamp.timePart, \':\'), 0)',
              'minute.$': 'States.ArrayGetItem(States.StringSplit($.formatTimestamp.timePart, \':\'), 1)'
            }
          },
          ResultPath: "$.formatPath",
          Next: 'Aggregate Preprocess'
        },
        'Aggregate Preprocess': {
          Type: 'Task',
          Resource: 'arn:aws:states:::glue:startJobRun.sync',
          Parameters: {
            JobName: props.aggregatePreprocessGlueJob.ref,
            Arguments: {
              "--CATALOG_DB": props.glueDatabase.ref,
              "--JOB_NAME": "aggr-preprocess-job",
              "--BUCKET_NAME.$": "$.formatPath.bucketName",
              //"--KEY.$": "$.keyName",
              "--PATH.$": "States.Format('year={}/month={}/day={}/hour={}/minute={}/',$.formatPath.datePath.year,$.formatPath.datePath.month,$.formatPath.datePath.day,$.formatPath.datePath.hour,$.formatPath.datePath.minute)",
              "--WORKFLOW_ID.$": "$.workflowId"
            }
          },
          ResultPath : "$.AggreJobResult",
          Next: 'Process Items'
        },       
        'Process Items': {
          Type: 'Map',
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'DISTRIBUTED',
              ExecutionType: 'EXPRESS'
            },
            StartAt: 'Process Item',
            States: {
              'Process Item': {
                Type: 'Task',
                Resource: "arn:aws:states:::lambda:invoke",
                OutputPath: '$.Payload',
                Parameters: {
                  FunctionName: props.ruleEngineClientFunction.functionArn,
                  Payload: {
                    "Input.$": "$"
                  }
                },
                Retry: [
                  {
                    ErrorEquals: ['States.ALL'],
                    IntervalSeconds: 1,
                    MaxAttempts: 3,
                    BackoffRate: 2,
                    JitterStrategy : "FULL"
                  }
                ],
                End: true
              }
            }
          },
          MaxConcurrency: 1000,
          ItemReader: {
            Resource: 'arn:aws:states:::s3:getObject',
            ReaderConfig: {
              InputType: 'CSV',
              CSVHeaderLocation: 'FIRST_ROW'
            },
            Parameters: {
              'Bucket.$': '$.formatPath.bucketName',
              "Key.$": "States.Format('year={}/month={}/day={}/hour={}/minute={}/{}-{}-{}-{}-{}.csv', $.formatPath.datePath.year, $.formatPath.datePath.month, $.formatPath.datePath.day, $.formatPath.datePath.hour, $.formatPath.datePath.minute, $.formatPath.datePath.year, $.formatPath.datePath.month, $.formatPath.datePath.day, $.formatPath.datePath.hour, $.formatPath.datePath.minute)"


            }
          },
          ItemBatcher: {
            MaxItemsPerBatch: 100,
            BatchInput: {
              "partition_info": {
                "year.$": "$.formatPath.datePath.year",
                "month.$": "$.formatPath.datePath.month",
                "day.$": "$.formatPath.datePath.day",
                "hour.$": "$.formatPath.datePath.hour",
                "minute.$": "$.formatPath.datePath.minute"
              }
            }
          },
          Next: 'Start Gold Crawler',
          ToleratedFailureCount : 1
        },
        'Start Gold Crawler': {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:glue:startCrawler',
          Parameters: {
            Name: props.goldCrawler.ref
          },
          Next: 'Get Gold Crawler State'
        },
        'Get Gold Crawler State': {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:glue:getCrawler',
          Parameters: {
            Name: props.goldCrawler.ref
          },
          Next: 'Check Gold Crawler State'
        },
        'Check Gold Crawler State': {
          Type: 'Choice',
          Choices: [
            {
              Variable: "$.Crawler.State",
              StringEquals: "RUNNING",
              Next: "Wait Gold Crawler"
            }
          ],
          Default: 'Send Completion Notification'
        },
        'Wait Gold Crawler': {
          Type: 'Wait',
          Seconds: 5,
          Next: 'Get Gold Crawler State'
        },
        'Send Completion Notification': {
          Type: 'Task',
          Resource: 'arn:aws:states:::sns:publish',
          Parameters: {
            TopicArn: topic.topicArn,
            'Message.$': '$'
          },
          End: true
        }
      }
    };

    // Create state machine
    const stateMachine = new stepfunctions.StateMachine(this, 'DataProcessingWorkflow', {
      definitionBody: stepfunctions.DefinitionBody.fromString(JSON.stringify(machineDefinition)),
      timeout: cdk.Duration.hours(2),
      role: stepFunctionRole
    });

    // Create EventBridge schedule
    const schedule = new events.Rule(this, 'WorkflowSchedule', {
      schedule: events.Schedule.expression('rate(1 day)'),
    });

    schedule.addTarget(new targets.SfnStateMachine(stateMachine));
  }
}
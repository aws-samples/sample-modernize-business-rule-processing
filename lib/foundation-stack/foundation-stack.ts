import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';


export class FoundationStack extends cdk.Stack {
    public readonly vpc: ec2.Vpc;
    public readonly bronzeBucket: cdk.aws_s3.Bucket;
    public readonly silverBucket: cdk.aws_s3.Bucket;
    public readonly goldBucket: cdk.aws_s3.Bucket;
    public readonly sqlServerInstance: ec2.Instance;
    public readonly sqlServerSecurityGroup: ec2.SecurityGroup;
    public readonly keyPairName: string;
    public readonly jobMetricsTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Get current region and account ID
        const region = cdk.Stack.of(this).region;
        const accountId = cdk.Stack.of(this).account;

        this.vpc = new ec2.Vpc(this, 'MainVPC', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
            ],
        });

        // Create Key Pair
        this.keyPairName = `sql-server-keypair-${region}`;
        
        // Create S3 Bucket named "bronze-bkt"

        const bronze_bkt_name = `bronze-bkt-${region}-${accountId}` 
        this.bronzeBucket = new s3.Bucket(this, 'bronze-bkt', {
            bucketName: bronze_bkt_name,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED
        });

        // Create S3 Bucket named "silver-bkt"

        const silver_bkt_name = `silver-bkt-${region}-${accountId}` 
        this.silverBucket = new s3.Bucket(this, 'silver-bkt', {
            bucketName: silver_bkt_name,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED
        });

        // Create S3 Bucket named "gold-bkt"

        const gold_bkt_name = `gold-bkt-${region}-${accountId}` 
        this.goldBucket = new s3.Bucket(this, 'gold-bkt', {
            bucketName: gold_bkt_name,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED
        });

        // Create DynamoDB table for job metrics tracking
       
        this.jobMetricsTable = new dynamodb.Table(this, 'JobMetricsTable', {
            partitionKey: {
            name: 'partitionKey',
            type: dynamodb.AttributeType.STRING
            },
            sortKey: {
            name: 'jobName',
            type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
        
        // Create S3 gateway endpoint
        new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
            vpc: this.vpc,
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [{
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }]
        });

        // Create Security Group for SQL Server
        this.sqlServerSecurityGroup = new ec2.SecurityGroup(this, 'SQLServerSG', {
            vpc: this.vpc,
            description: 'Security Group for SQL Server',
            allowAllOutbound: true,
        });

        this.sqlServerSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
            ec2.Port.tcp(1433),
            'Allow SQL Server access'
        );

        // Create Role for EC2 instance
        const role = new cdk.aws_iam.Role(this, 'EC2Role', {
            assumedBy: new cdk.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
        });

        // Add SSM Managed Policy to allow Fleet Manager access
        role.addManagedPolicy(
            cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
        );

        // Create EC2 Instance with SQL Server
        this.sqlServerInstance = new ec2.Instance(this, 'SQLServerInstance', {
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.XLARGE),
            machineImage: new ec2.WindowsImage(ec2.WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_SQL_2022_EXPRESS),
            securityGroup: this.sqlServerSecurityGroup,
            keyName: this.keyPairName,
            role: role,
            detailedMonitoring: true,
        });
        
        // // Enable termination protection using CfnInstance
        // const cfnInstance = this.sqlServerInstance.node.defaultChild as ec2.CfnInstance;
        // cfnInstance.disableApiTermination = true;

        // Add tags for better identification
        cdk.Tags.of(this.sqlServerInstance).add('Name', 'SQLServerDev');
        cdk.Tags.of(this.sqlServerInstance).add('Environment', 'Development');

        // Outputs
        

        new cdk.CfnOutput(this, 'KeyPairName', {
            value: this.keyPairName,
            description: 'Key Pair Name',
        });


    }
}
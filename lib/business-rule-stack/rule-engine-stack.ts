
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as path from 'path';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import { FoundationStack } from '../foundation-stack/foundation-stack';

interface RuleEngineStackProps extends cdk.StackProps {
  foundationStack: FoundationStack;
}

export class RuleEngineStack extends cdk.Stack {
  public readonly ruleEngineService: ecsPatterns.ApplicationLoadBalancedFargateService;
  constructor(scope: Construct, id: string, props: RuleEngineStackProps) {
    super(scope, id, props);

    const dockerPlatform = process.env["DOCKER_CONTAINER_PLATFORM_ARCH"]

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'RuleProcessingCluster', {
      vpc: props.foundationStack.vpc,
      containerInsights: true,
    });

    // Build and push Docker image using CDK
    const dockerImage = new DockerImageAsset(this, 'DroolsImage', {
      directory: path.join(__dirname, '../../rule-engine-drool/'), // Points to project root
      file: 'Dockerfile',
      platform: dockerPlatform == "arm" ? ecr_assets.Platform.LINUX_ARM64 : ecr_assets.Platform.LINUX_AMD64
    });

    // Create Task Role
    const taskRole = new iam.Role(this, 'RuleEngineTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add necessary permissions to task role
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // Create Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'RuleEngineTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: taskRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: dockerPlatform == "arm" ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64
      },
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('RuleEngineContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'rule-engine-service' }),
      environment: {
        'SPRING_PROFILES_ACTIVE': 'prod',
        'SERVER_PORT': '8080'
      },
      portMappings: [{ containerPort: 8080 }],
      
    });

    // Create Security Group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.foundationStack.vpc,
      description: 'Security Group for ALB',
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    // Create Security Group for ECS Service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: props.foundationStack.vpc,
      description: 'Security Group for ECS Service',
      allowAllOutbound: true,
    });

    serviceSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow traffic from ALB'
    );

    // Create Fargate Service
    this.ruleEngineService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'RuleEngineService', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 2,
      publicLoadBalancer: true, // Since we're in a private subnet
      listenerPort: 80,
      targetProtocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      securityGroups: [serviceSecurityGroup],
      assignPublicIp: true, // Change based on your requirements
      taskSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Change to PRIVATE if using NAT Gateway
      },
    });

    // Configure health check for target group
    this.ruleEngineService.targetGroup.configureHealthCheck({
      path: '/actuator/health',
      port: '8080',
      protocol: cdk.aws_elasticloadbalancingv2.Protocol.HTTP,
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      healthyHttpCodes: '200',
    });

    // Auto Scaling configuration
    const scaling = this.ruleEngineService.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    
    // Output the Load Balancer DNS
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.ruleEngineService.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS',
    });

    new cdk.CfnOutput(this, 'ServiceURL', {
      value: `http://${this.ruleEngineService.loadBalancer.loadBalancerDnsName}`,
      description: 'Service URL',
    });
  }
}

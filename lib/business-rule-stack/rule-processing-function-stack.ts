import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

interface RuleProcessingFunctionStackProps extends cdk.StackProps {
  goldBucket: s3.IBucket;
  ruleEngineService: ecsPatterns.ApplicationLoadBalancedFargateService;
}

export class RuleProcessingFunctionStack extends cdk.Stack {
  public readonly ruleProcessingFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: RuleProcessingFunctionStackProps) {
    super(scope, id, props);
    
    // capturing architecture for docker container (arm or x86)
    const dockerPlatform = process.env["DOCKER_CONTAINER_PLATFORM_ARCH"] 

    // Define build options
    const buildOptions = {
      platform: dockerPlatform == "arm" ? Platform.LINUX_ARM64 : Platform.LINUX_AMD64,
      buildArgs: {
        DOCKER_BUILDKIT: '1',
        BUILDKIT_PROGRESS: 'plain'
        
      },
      file: 'Dockerfile'
    };

    // Docker assets for lambda function
    const dockerfileRuleClientFn = path.join(__dirname, '../../rule-processing-lambda');

     // create a Lambda function
     this.ruleProcessingFunction = new lambda.DockerImageFunction(this, "RuleEngineClientFunction", {
        code: lambda.DockerImageCode.fromImageAsset(dockerfileRuleClientFn,buildOptions),
        timeout: cdk.Duration.minutes(5),
        memorySize: 256,
        architecture: dockerPlatform == "arm" ? lambda.Architecture.ARM_64 : lambda.Architecture.X86_64,
        //architecture: lambda.Architecture.X86_64,
        environment: {
          GOLD_BUCKET_NAME: props.goldBucket.bucketName,
          RULE_ENGINE_SERVICE_URL: `http://${props.ruleEngineService.loadBalancer.loadBalancerDnsName}/policy/premium`
        }
    }); 

    // Grant the Lambda function read/write access to the Gold bucket
    props.goldBucket.grantReadWrite(this.ruleProcessingFunction);
  }
}
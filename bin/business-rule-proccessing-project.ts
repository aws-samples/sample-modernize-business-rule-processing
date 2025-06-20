#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack/foundation-stack';
import { RuleEngineStack } from '../lib/business-rule-stack/rule-engine-stack';
import { DataProcessingStack } from '../lib/data-pipeline-stack/data-processing-stack';
import { RuleProcessingFunctionStack } from '../lib/business-rule-stack/rule-processing-function-stack';
import { DataWorkflowStack } from '../lib/data-pipeline-stack/data-workflow-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

// Import the custom NagSuppressor
import { NagSuppressor } from '../lib/nag-pack-options';

// Check if we should skip CDK-NAG checks (for testing)
const skipNagChecks = process.env.SKIP_CDK_NAG === 'true';

if (skipNagChecks) {
  // If skipping, add a suppressor that will add metadata to suppress all rules
  Aspects.of(app).add(new NagSuppressor());
} else {
  // Otherwise, add the normal CDK-NAG checks
  Aspects.of(app).add(new AwsSolutionsChecks({ 
    verbose: true
  }));
}

// Import the suppressions utility
import { applyNagSuppressions } from '../lib/nag-suppressions';

// Create the foundation stack with environment configuration
const foundationStack = new FoundationStack(app, 'FoundationStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

// Create the rule processing stack
const ruleEngineStack = new RuleEngineStack(app, 'RuleEngineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  foundationStack: foundationStack,
});

// Add dependency
ruleEngineStack.addDependency(foundationStack);

// Create the rule client stack
const ruleProcessingFunctionStack = new RuleProcessingFunctionStack(app, 'RuleProcessingFunctionStack', {
  goldBucket: foundationStack.goldBucket,
  ruleEngineService: ruleEngineStack.ruleEngineService,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

ruleProcessingFunctionStack.addDependency(ruleEngineStack)

// Create the Glue Resources stack
const dataProcessingStack = new DataProcessingStack(app, 'DataProcessingStack', {
  vpc: foundationStack.vpc,
  sqlServerSecurityGroup: foundationStack.sqlServerSecurityGroup,
  sqlServerInstance: foundationStack.sqlServerInstance,
  bronzeBucket: foundationStack.bronzeBucket,
  silverBucket: foundationStack.silverBucket,
  goldBucket: foundationStack.goldBucket,
  jobMetricsTable: foundationStack.jobMetricsTable,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

// Add dependency
dataProcessingStack.addDependency(foundationStack);

// Create the Step function workflow stack
const dataWorkflow = new DataWorkflowStack(app, 'DataWorkflowStack', {
  extractCarGlueJob: dataProcessingStack.extractCarGlueJob,
  extractDriverGlueJob: dataProcessingStack.extractDriverGlueJob,
  extractPolicyGlueJob: dataProcessingStack.extractPolicyGlueJob,
  extractInsuranceRequestGlueJob: dataProcessingStack.extractInsuranceRequestGlueJob,
  bronzeCrawler: dataProcessingStack.bronzeCrawler,
  aggregatePreprocessGlueJob: dataProcessingStack.aggregatePreprocessGlueJob,
  goldCrawler: dataProcessingStack.goldCrawler,
  ruleEngineClientFunction : ruleProcessingFunctionStack.ruleProcessingFunction,
  silverBucket : foundationStack.silverBucket,
  glueDatabase: dataProcessingStack.glueDatabase,
  checkProcessRecordLambda: dataProcessingStack.checkProcessRecordLambda,
  jobMetricsTable: foundationStack.jobMetricsTable,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
dataWorkflow.addDependency(dataProcessingStack);

// Apply CDK-NAG suppressions to all stacks if not skipped
if (!skipNagChecks) {
  applyNagSuppressions(app);
}

// Add stack-specific suppressions if not skipped
if (!skipNagChecks) {
  NagSuppressions.addStackSuppressions(foundationStack, [
    {
      id: 'AwsSolutions-EC23',
      reason: 'SQL Server EC2 instance is used for demonstration purposes',
    },
    {
      id: 'AwsSolutions-EC26',
      reason: 'This demo does not require encryption enabled for the EBS volume',
    }
  ]);

  NagSuppressions.addStackSuppressions(ruleEngineStack, [
    {
      id: '*',
      reason: 'Suppress all for testing',
    },
    {
      id: 'AwsSolutions-ECS2',
      reason: 'Container insights are enabled at the cluster level',
    },
    {
      id: 'AwsSolutions-ELB2',
      reason: 'Access logs are not required for this demonstration',
    },
  ]);

  NagSuppressions.addStackSuppressions(dataProcessingStack, [
    
    {
      id: 'AwsSolutions-SMG4',
      reason: 'This demo is not for production environment and does not need to schedule automatic rotation of AWS Secret Manager secrets',
    },
    {
      id: 'AwsSolutions-L1',
      reason: 'This demo is not for production environment so we are relying on the CDK Bucket deployment construct',
    },
  ]);

  NagSuppressions.addStackSuppressions(dataWorkflow, [
    
    {
      id: 'AwsSolutions-SF1',
      reason: 'This demo is not for production environment and does not need to log all the STEP Function events to CloudWatch log',
    },
    {
      id: 'AwsSolutions-SF2',
      reason: 'This demo is not for production environment and does not need to X-Ray logging enabled for STEP Function',
    },
  ]);
}

// You can add more stack-specific suppressions as needed
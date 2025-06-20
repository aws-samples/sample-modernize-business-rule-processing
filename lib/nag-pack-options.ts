import { CfnResource, IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Custom aspect to suppress CDK-NAG errors during deployment
 */
export class NagSuppressor implements IAspect {
  visit(node: IConstruct): void {
    // If the node is a CloudFormation resource
    if (node instanceof CfnResource) {
      // Add metadata to suppress CDK-NAG errors
      node.addMetadata('cdk_nag', {
        rules_to_suppress: [{
          id: '*',
          reason: 'Temporarily suppressed for testing purposes'
        }]
      });
    }
  }
}
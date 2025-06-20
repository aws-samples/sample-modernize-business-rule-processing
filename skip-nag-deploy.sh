#!/bin/bash

# Script to deploy CDK stacks with CDK-NAG checks disabled
# Usage: ./skip-nag-deploy.sh <stack-names> [--profile profile-name]

# Set environment variable to skip CDK-NAG checks
export SKIP_CDK_NAG=true

# Pass all arguments to cdk deploy
cdk deploy "$@"
import boto3
import os
import json
from decimal import Decimal
from datetime import datetime

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super(DecimalEncoder, self).default(obj)

def handler(event, context):
    # Initialize DynamoDB client
    dynamodb = boto3.resource('dynamodb')
    print(f"Event: {event}")
    metrics_table_name = os.environ.get('METRICS_TABLE_NAME', 'JobMetricsTable')
    metrics_table = dynamodb.Table(metrics_table_name)
    print(f"Metrics table name: {metrics_table_name}")
    
    
    # Fetch records from DynamoDB based on partition keys in event
    result_records = {}
    total_records_processed = 0
    
    # Check if partition_keys is provided in the event
    partition_keys = event.get('partition_keys', [])
    
    for partition_key in partition_keys:
        # Query the DynamoDB table for records with the provided partition key
        response = metrics_table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('partitionKey').eq(partition_key)
        )
        
        # Add each item to the results
        for item in response.get('Items', []):
            if item['dbTableName'] == 'Sales.Car':
                # check if first_car_id and last_car_id are already set
                if 'first_id' in item:
                    result_records['first_car_id'] = item['firstProcessedId']
                if 'last_id' in item:
                    result_records['last_car_id'] = item['lastProcessedId']  
            if item['dbTableName'] == 'Sales.Driver':
                # check if first_car_id and last_car_id are already set
                if 'first_id' in item:
                    result_records['first_driver_id'] = item['firstProcessedId']
                if 'last_id' in item:
                    result_records['last_driver_id'] = item['lastProcessedId']  
            if item['dbTableName'] == 'Sales.Policy':
                # check if first_car_id and last_car_id are already set
                if 'first_id' in item:
                    result_records['first_policy_id'] = item['firstProcessedId']
                if 'last_id' in item:
                    result_records['last_policy_id'] = item['lastProcessedId'] 
            if item['dbTableName'] == 'Sales.InsuranceRequest':
                # check if first_car_id and last_car_id are already set
                if 'first_id' in item:
                    result_records['first_request_id'] = item['firstProcessedId']
                if 'last_id' in item:
                    result_records['last_request_id'] = item['lastProcessedId']                      
            #result_records.append(item)
            records_processed = item.get('recordsProcessed', 0)
            total_records_processed += records_processed
    
    # Return results as a JSON array
    return {
        'processed_records': total_records_processed,
        'should_continue': total_records_processed > 0,
        'job_metrics': json.loads(json.dumps(result_records, cls=DecimalEncoder))
    }
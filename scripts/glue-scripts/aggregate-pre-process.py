import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Tuple, Dict, Any
from awsglue.utils import getResolvedOptions
from pyspark.sql import SparkSession
import boto3
from botocore.config import Config
import logging



def create_spark_session() -> SparkSession:
    """Create and configure SparkSession with optimized settings."""
    
    return SparkSession.builder \
         .config("spark.sql.shuffle.partitions", "200") \
         .config("spark.sql.adaptive.enabled", "true") \
         .config("spark.sql.adaptive.coalescePartitions.enabled", "true") \
         .config("spark.sql.statistics.histogram.enabled", "true") \
         .getOrCreate()


def get_athena_query(year: str, month: str, day: str, processed_ids: Dict) -> str:
    print(f"***processed_ids= {processed_ids}")
    """Return optimized Athena query with proper indexing hints and partition predicates."""
    return f"""
            WITH car_data AS (
            SELECT 
                carid,
                make,
                model,
                style, 
                color,
                createddate as car_createddate,
                DATE_TRUNC('year', createddate) as car_year,
                DATE_TRUNC('month', createddate) as car_month,
                DATE_TRUNC('day', createddate) as car_day
            FROM ins_sales_car
            WHERE year = '{year}'
            AND month = '{month}'
            AND day = '{day}'
            AND carid >= {processed_ids.get('first_car_id',0)}
        ),
        driver_data AS (
            SELECT 
                driverid,
                name,
                age,
                licensedate,
                DATE_TRUNC('year', licensedate) as license_year,
                DATE_TRUNC('month', licensedate) as license_month,
                DATE_TRUNC('day', licensedate) as license_day
            FROM ins_sales_driver
            WHERE year = '{year}'
            AND month = '{month}' 
            AND day = '{day}'
            AND driverid >= {processed_ids.get('first_driver_id',0)}
        ),
        policy_data AS (
            SELECT 
                policyid,
                premium,
                startdate,
                enddate,
                createddate as policy_createddate,
                DATE_TRUNC('year', createddate) as policy_year,
                    DATE_TRUNC('month', createddate) as policy_month,
                    DATE_TRUNC('day', createddate) as policy_day
            FROM ins_sales_policy
            WHERE year = '{year}'
            AND month = '{month}'
            AND day = '{day}'
            AND policyid >= {processed_ids.get('first_policy_id',0)}
        ),
        request_data AS (
            SELECT 
                requestid,
                carid,
                driverid,
                policyid,
                requestdate
            FROM ins_sales_insurancerequest
            WHERE year = '{year}'
            AND month = '{month}'
            AND day = '{day}'
            AND requestid >= {processed_ids.get('first_request_id',0)}
        )
        SELECT /*+ BROADCAST(car_data) BROADCAST(driver_data) */
            r.requestid,
            r.requestdate,
            c.carid,
            c.make,
            c.model,
            c.style,
            c.color,
            c.car_createddate,
            d.driverid,
            d.name,
            d.age,
            d.licensedate,
            p.policyid,
            p.premium,
            p.startdate,
            p.enddate,
            p.policy_createddate
        FROM request_data r
        JOIN car_data c ON r.carid = c.carid
        JOIN driver_data d ON r.driverid = d.driverid
        JOIN policy_data p ON r.policyid = p.policyid
    """


# def get_athena_query(year: str, month: str, day: str, processed_ids: Dict) -> str:
#     print(f"***processed_ids= {processed_ids}")
#     """Return optimized Athena query with proper indexing hints and partition predicates."""
#     return f"""
#     WITH car_data AS (
#         SELECT /*+ BROADCAST(ins_sales_car) */
#             carid,
#             make,
#             model,
#             style, 
#             color,
#             createddate as car_createddate,
#             DATE_TRUNC('year', createddate) as car_year,
#             DATE_TRUNC('month', createddate) as car_month,
#             DATE_TRUNC('day', createddate) as car_day
#         FROM ins_sales_car
#         WHERE year = '{year}'
#         AND month = '{month}'
#         AND day = '{day}'
#         AND carid >= {processed_ids.get('first_car_id',0)}
#     ),
#     driver_data AS (
#         SELECT /*+ BROADCAST(ins_sales_driver) */
#             driverid,
#             name,
#             age,
#             licensedate,
#             DATE_TRUNC('year', licensedate) as license_year,
#             DATE_TRUNC('month', licensedate) as license_month,
#             DATE_TRUNC('day', licensedate) as license_day
#         FROM ins_sales_driver
#         WHERE year = '{year}'
#         AND month = '{month}' 
#         AND day = '{day}'
#         AND driverid >= {processed_ids.get('first_driver_id',0)}
#     ),
#     policy_data AS (
#         SELECT 
#             policyid,
#             premium,
#             startdate,
#             enddate,
#             createddate as policy_createddate,
#             DATE_TRUNC('year', createddate) as policy_year,
#             DATE_TRUNC('month', createddate) as policy_month,
#             DATE_TRUNC('day', createddate) as policy_day
#         FROM ins_sales_policy
#         WHERE year = '{year}'
#         AND month = '{month}'
#         AND day = '{day}'
#         AND policyid >= {processed_ids.get('first_policy_id',0)}
#     )
#     SELECT /*+ BROADCAST(car_data) BROADCAST(driver_data) */
#         c.*,
#         d.*,
#         p.*
#     FROM ins_sales_insurancerequest i
#     JOIN car_data c ON i.carid = c.carid
#     JOIN driver_data d ON i.driverid = d.driverid
#     JOIN policy_data p ON i.policyid = p.policyid
#     WHERE i.year = '{year}'
#     AND i.month = '{month}'
#     AND i.day = '{day}'
#     AND i.requestid >= {processed_ids.get('first_request_id',0)}
#     """

def execute_athena_query(athena_client: boto3.client, 
                        query: str, 
                        database: str, 
                        output_location: str) -> str:
    """Execute Athena query with retry mechanism."""
    MAX_RETRIES = 3
    INITIAL_BACKOFF = 1  # seconds
    
    for attempt in range(MAX_RETRIES):
        try:
            response = athena_client.start_query_execution(
                QueryString=query,
                QueryExecutionContext={'Database': database},
                ResultConfiguration={'OutputLocation': output_location},
                WorkGroup='primary'
            )
            return response['QueryExecutionId']
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(INITIAL_BACKOFF * (2 ** attempt))  # Exponential backoff

def check_query_status(athena_client: boto3.client, 
                      query_execution_id: str) -> Tuple[str, Dict[str, Any]]:
    """Check Athena query status with timeout and exponential backoff."""
    TIMEOUT = 900  # 15 minutes
    MAX_BACKOFF = 32  # Maximum backoff time in seconds
    backoff_time = 1  # Initial backoff time in seconds
    start_time = time.time()
    
    while (time.time() - start_time) < TIMEOUT:
        response = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        state = response['QueryExecution']['Status']['State']
        
        if state in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
            return state, response
        
        # Use exponential backoff with a cap
        backoff_time = min(backoff_time * 2, MAX_BACKOFF)
        # Add a small random jitter to avoid thundering herd problem
        jitter = backoff_time * 0.1 * (2 * (time.time() % 1) - 1)
        wait_time = backoff_time + jitter
        
        # Check if waiting would exceed the timeout
        if (time.time() + wait_time - start_time) >= TIMEOUT:
            # If next wait would exceed timeout, wait just enough to reach timeout
            remaining = TIMEOUT - (time.time() - start_time)
            if remaining > 0:
                time.sleep(remaining)
            break
        
        time.sleep(wait_time)
    
    raise TimeoutError("Query execution exceeded timeout")

def rename_output_file(s3_client: boto3.client, 
                      bucket_name: str, 
                      original_key: str, 
                      new_key: str) -> None:
    """Rename output file with error handling."""
    try:
        s3_client.copy_object(
            Bucket=bucket_name,
            CopySource={'Bucket': bucket_name, 'Key': original_key},
            Key=new_key
        )
        s3_client.delete_object(Bucket=bucket_name, Key=original_key)
    except Exception as e:
        raise Exception(f"Error renaming file: {str(e)}")

class JobMetricsTracker:
    def __init__(self, workflow_id, metrics_table_name: str):
        
        self.dynamodb = boto3.resource('dynamodb')
        self.workflow_id = workflow_id
        self.dbTableNames = ['car','driver','policy','insurance']
        self.metrics_table_name = metrics_table_name
        
        self.metrics_table = self.dynamodb.Table(self.metrics_table_name)
        self.logger = logging.getLogger(__name__)

    
        
    def get_processed_ids(self) -> Dict:
        """Retrieve the first and last processed IDs from DynamoDB table"""
        processed_ids = {}
        for name in self.dbTableNames:
            partition_key = f"{self.workflow_id}-{name}"
            print(f"partition key is=== {partition_key}")
            #response = self.metrics_table.get_item(Key={'partitionKey': partition_key})
            response = self.metrics_table.query(
                KeyConditionExpression=boto3.dynamodb.conditions.Key('partitionKey').eq(partition_key)
            )
            print(f"DynamoDB response for {name}: {response}")
                    
            # Add each item to the results
            for item in response.get('Items', []):
                if item['dbTableName'] == 'Sales.Car':
                    # check if first_car_id and last_car_id are already set
                    if 'firstProcessedId' in item:
                        processed_ids['first_car_id'] = item['firstProcessedId']
                    if 'lastProcessedId' in item:
                        processed_ids['last_car_id'] = item['lastProcessedId']  
                if item['dbTableName'] == 'Sales.Driver':
                    # check if first_car_id and last_car_id are already set
                    if 'firstProcessedId' in item:
                        processed_ids['first_driver_id'] = item['firstProcessedId']
                    if 'lastProcessedId' in item:
                        processed_ids['last_driver_id'] = item['lastProcessedId']  
                if item['dbTableName'] == 'Sales.Policy':
                    # check if first_car_id and last_car_id are already set
                    if 'firstProcessedId' in item:
                        processed_ids['first_policy_id'] = item['firstProcessedId']
                    if 'lastProcessedId' in item:
                        processed_ids['last_policy_id'] = item['lastProcessedId'] 
                if item['dbTableName'] == 'Sales.InsuranceRequest':
                    # check if first_car_id and last_car_id are already set
                    if 'firstProcessedId' in item:
                        processed_ids['first_request_id'] = item['firstProcessedId']
                    if 'lastProcessedId' in item:
                        processed_ids['last_request_id'] = item['lastProcessedId']

        return processed_ids                
    

def main():
    # Initialize parameters
    args = getResolvedOptions(sys.argv, ['JOB_NAME', 'BUCKET_NAME', 'CATALOG_DB', 'PATH','WORKFLOW_ID','METRICS_TABLE_NAME'])
    bucket_name = args['BUCKET_NAME']
    
    jobMetricsTracker = JobMetricsTracker(args['WORKFLOW_ID'], args['METRICS_TABLE_NAME'])
    processed_ids = jobMetricsTracker.get_processed_ids()

    # Extract partition values from PATH
    path_parts = args['PATH'].split('/')
    year = path_parts[0].split('=')[1]
    month = path_parts[1].split('=')[1]
    day = path_parts[2].split('=')[1]
    hour = path_parts[3].split('=')[1]
    minute = path_parts[4].split('=')[1]

    output_s3_path = f"s3://{bucket_name}/{path_parts[0]}/{path_parts[1]}/{path_parts[2]}/{path_parts[3]}/{path_parts[4]}"
    
    print(f"Extracting data for year={year}, month={month}, day={day}")

    # Initialize AWS clients with retry configuration
    config = Config(
        retries = dict(
            max_attempts = 3,
            mode = 'adaptive'
        )
    )
    athena_client = boto3.client('athena', config=config)
    s3_client = boto3.client('s3', config=config)

    try:
        # Execute Athena query
        query_execution_id = execute_athena_query(
            athena_client, 
            get_athena_query(year, month, day, processed_ids),
            args['CATALOG_DB'], 
            output_s3_path
        )

        # Check query status asynchronously
        with ThreadPoolExecutor() as executor:
            future = executor.submit(check_query_status, athena_client, query_execution_id)
            state, response = future.result()

        if state == 'SUCCEEDED':
            # Process successful query
            original_file = response['QueryExecution']['ResultConfiguration']['OutputLocation']
            original_parts = original_file.replace("s3://", "").split("/")
            original_key = '/'.join(original_parts[1:])
            newfile_name = f"{year}-{month}-{day}-{hour}-{minute}.csv"
            new_key = f"{'/'.join(original_key.split('/')[:-1])}/{newfile_name}"

            # Rename output file
            rename_output_file(s3_client, bucket_name, original_key, new_key)
            print(f"File successfully processed and renamed to: s3://{bucket_name}/{new_key}")
        else:
            error_message = response['QueryExecution']['Status'].get('StateChangeReason', 'Unknown error')
            raise Exception(f"Query failed: {error_message}")

    except Exception as e:
        print(f"Error in job execution: {str(e)}")
        raise

if __name__ == "__main__":
    main()

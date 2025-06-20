-- Load New Data SQL Script

-- 1. Get Current Maximum IDs


DECLARE @MaxCarID INT, @MaxDriverID INT, @MaxPolicyID INT, @MaxRequestID INT;

SELECT @MaxCarID = ISNULL(MAX(CarID), 0) FROM Sales.Car;
SELECT @MaxDriverID = ISNULL(MAX(DriverID), 0) FROM Sales.Driver;
SELECT @MaxPolicyID = ISNULL(MAX(PolicyID), 0) FROM Sales.Policy;
SELECT @MaxRequestID = ISNULL(MAX(RequestID), 0) FROM Sales.InsuranceRequest;


-- 2. Insert 5,000 New Cars

--Use a common table expression to generate 5,000 rows:

WITH Numbers AS (
    SELECT TOP 5000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.columns a
    CROSS JOIN sys.columns b
)
INSERT INTO Sales.Car (Make, Model, Year, Style, Color, CreatedDate)
SELECT 
    CHOOSE(1 + (n % 5), 'Toyota', 'Honda', 'Ford', 'BMW', 'Tesla') AS Make,
    CHOOSE(1 + (n % 5), 'Camry', 'CR-V', 'Mustang', 'X5', 'Model 3') AS Model,
    2020 + (ABS(CHECKSUM(NEWID())) % 4) AS Year,
    CHOOSE(1 + (n % 5), 'Sedan', 'SUV', 'Coupe', 'SUV', 'Sedan') AS Style,
    CHOOSE(1 + (n % 5), 'Black', 'White', 'Silver', 'Blue', 'Red') AS Color,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS CreatedDate
FROM Numbers;

---- 3. Insert 5,000 New Drivers

--Use the same approach for generating 5,000 rows but include the increment from the maximum DriverID:


INSERT INTO Sales.Driver (Name, Age, LicenseDate, CreatedDate)
SELECT TOP 5000
    'Driver_' + CAST(@MaxDriverID + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS NVARCHAR(10)),
    25 + (ABS(CHECKSUM(NEWID())) % 40),
    DATEADD(YEAR, -(25 + (ABS(CHECKSUM(NEWID())) % 40)), GETDATE()),
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE())
FROM sys.columns a
CROSS JOIN sys.columns b;


--- 4. Insert 5,000 New Policies


WITH Numbers AS (
    SELECT TOP 5000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.columns a
    CROSS JOIN sys.columns b
)
INSERT INTO Sales.Policy (Premium, StartDate, EndDate, CreatedDate)
SELECT 
    CAST(ROUND(1000 + (ABS(CHECKSUM(NEWID())) % 2000) + RAND() * 1000, 2) AS DECIMAL(10,2)) AS Premium,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS StartDate,
    DATEADD(YEAR, 1, DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE())) AS EndDate,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS CreatedDate
FROM Numbers;


--- 5. Insert 5,000 New Insurance Requests

---Link the newly created cars, drivers, and policies:

WITH NewCars AS (
    SELECT CarID, ROW_NUMBER() OVER (ORDER BY CarID) AS RowNum
    FROM Sales.Car
    WHERE CarID > @MaxCarID
),
NewDrivers AS (
    SELECT DriverID, ROW_NUMBER() OVER (ORDER BY DriverID) AS RowNum
    FROM Sales.Driver
    WHERE DriverID > @MaxDriverID
),
NewPolicies AS (
    SELECT PolicyID, ROW_NUMBER() OVER (ORDER BY PolicyID) AS RowNum
    FROM Sales.Policy
    WHERE PolicyID > @MaxPolicyID
)
INSERT INTO Sales.InsuranceRequest (CarID, DriverID, PolicyID, RequestDate, CreatedDate)
SELECT 
    c.CarID,
    d.DriverID,
    p.PolicyID,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS RequestDate,
    DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS CreatedDate
FROM NewCars c
JOIN NewDrivers d ON c.RowNum = d.RowNum
JOIN NewPolicies p ON c.RowNum = p.RowNum;


--- 6. Verify Record Counts


SELECT 
    'New Cars Added' as Description, COUNT(*) as Count 
FROM Sales.Car WHERE CarID > @MaxCarID
UNION ALL
SELECT 
    'New Drivers Added', COUNT(*) 
FROM Sales.Driver WHERE DriverID > @MaxDriverID
UNION ALL
SELECT 
    'New Policies Added', COUNT(*) 
FROM Sales.Policy WHERE PolicyID > @MaxPolicyID
UNION ALL
SELECT 
    'New Insurance Requests Added', COUNT(*) 
FROM Sales.InsuranceRequest WHERE RequestID > @MaxRequestID;
SET NOCOUNT ON;
GO

-- Create Sales schema if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'Sales')
BEGIN
    EXEC('CREATE SCHEMA Sales')
    PRINT 'Sales schema created successfully.'
END
GO

-- Drop existing tables in correct order
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'InsuranceRequest' AND schema_id = SCHEMA_ID('Sales'))
    DROP TABLE Sales.InsuranceRequest;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Car' AND schema_id = SCHEMA_ID('Sales'))
    DROP TABLE Sales.Car;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Driver' AND schema_id = SCHEMA_ID('Sales'))
    DROP TABLE Sales.Driver;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Policy' AND schema_id = SCHEMA_ID('Sales'))
    DROP TABLE Sales.Policy;
GO

-- Create tables with proper indexes
CREATE TABLE Sales.Car
(
    CarID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    Make NVARCHAR(50) NOT NULL,
    Model NVARCHAR(50) NOT NULL,
    Year INT NOT NULL,
    Style NVARCHAR(20) NOT NULL,
    Color NVARCHAR(20) NOT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Sales.Driver
(
    DriverID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    Name NVARCHAR(100) NOT NULL,
    Age INT NOT NULL,
    LicenseDate DATE NOT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Sales.Policy
(
    PolicyID INT IDENTITY(1000,1) PRIMARY KEY CLUSTERED,
    Premium DECIMAL(10,2) NOT NULL,
    StartDate DATE NOT NULL,
    EndDate DATE NOT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Sales.InsuranceRequest
(
    RequestID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    CarID INT NOT NULL,
    DriverID INT NOT NULL,
    PolicyID INT NOT NULL,
    RequestDate DATETIME NOT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_InsuranceRequest_Car FOREIGN KEY (CarID) REFERENCES Sales.Car(CarID),
    CONSTRAINT FK_InsuranceRequest_Driver FOREIGN KEY (DriverID) REFERENCES Sales.Driver(DriverID),
    CONSTRAINT FK_InsuranceRequest_Policy FOREIGN KEY (PolicyID) REFERENCES Sales.Policy(PolicyID)
);

-- Create nonclustered indexes for better query performance
CREATE NONCLUSTERED INDEX IX_InsuranceRequest_CarID ON Sales.InsuranceRequest(CarID);
CREATE NONCLUSTERED INDEX IX_InsuranceRequest_DriverID ON Sales.InsuranceRequest(DriverID);
CREATE NONCLUSTERED INDEX IX_InsuranceRequest_PolicyID ON Sales.InsuranceRequest(PolicyID);
CREATE NONCLUSTERED INDEX IX_InsuranceRequest_RequestDate ON Sales.InsuranceRequest(RequestDate);
GO

-- Enable bulk logging for better performance
ALTER DATABASE InsuranceDB SET RECOVERY BULK_LOGGED;
GO

-- Create minimal staging tables in tempdb
CREATE TABLE #CarData
(
    Make NVARCHAR(50),
    Model NVARCHAR(50),
    Style NVARCHAR(20)
);

INSERT INTO #CarData VALUES 
('Toyota', 'Camry', 'Sedan'),
('Honda', 'CR-V', 'SUV'),
('Ford', 'Mustang', 'Coupe'),
('BMW', 'X5', 'SUV'),
('Tesla', 'Model 3', 'Sedan');

CREATE TABLE #Colors (Color NVARCHAR(20));
INSERT INTO #Colors VALUES ('Black'),('White'),('Silver'),('Blue'),('Red');

BEGIN TRY
    -- Insert Cars using minimal logging
   WITH Numbers AS (
        SELECT TOP 10000
            n = ROW_NUMBER() OVER (ORDER BY (SELECT NULL))
        FROM sys.columns a
        CROSS JOIN sys.columns b
    )
    INSERT INTO Sales.Car WITH (TABLOCK) (Make, Model, Year, Style, Color, CreatedDate)
    SELECT 
        Make = CHOOSE(1 + (n % 5), 'Toyota', 'Honda', 'Ford', 'BMW', 'Tesla'),
        Model = CHOOSE(1 + (n % 5), 'Camry', 'CR-V', 'Mustang', 'X5', 'Model 3'),
        Year = 2020 + (ABS(CHECKSUM(NEWID())) % 4),
        Style = CHOOSE(1 + (n % 5), 'Sedan', 'SUV', 'Coupe', 'SUV', 'Sedan'),
        Color = CHOOSE(1 + (n % 5), 'Black', 'White', 'Silver', 'Blue', 'Red'),
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE())
    FROM Numbers;

    -- Insert Drivers using minimal logging
    INSERT INTO Sales.Driver WITH (TABLOCK) (Name, Age, LicenseDate, CreatedDate)
    SELECT TOP 10000
        'Driver_' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS NVARCHAR(10)),
        25 + (ABS(CHECKSUM(NEWID())) % 40),
        DATEADD(YEAR, -(25 + (ABS(CHECKSUM(NEWID())) % 40)), GETDATE()),
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE())
    FROM sys.columns a
    CROSS JOIN sys.columns b;

    -- Insert Policies using minimal logging
    WITH Numbers AS (
        SELECT TOP 10000
            ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
        FROM sys.columns a
        CROSS JOIN sys.columns b
    )
    INSERT INTO Sales.Policy WITH (TABLOCK) (Premium, StartDate, EndDate, CreatedDate)
    SELECT 
        CAST(ROUND(1000 + (ABS(CHECKSUM(NEWID())) % 2000) + RAND() * 1000, 2) AS DECIMAL(10,2)) AS Premium,
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS StartDate,
        DATEADD(YEAR, 1, DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE())) AS EndDate,
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS CreatedDate
    FROM Numbers;

    -- Insert Insurance Requests using minimal logging
    WITH NumberSequence AS (
        SELECT TOP 10000
            ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
        FROM sys.columns a
        CROSS JOIN sys.columns b
    )
    INSERT INTO Sales.InsuranceRequest WITH (TABLOCK) (CarID, DriverID, PolicyID, RequestDate, CreatedDate)
    SELECT 
        c.CarID,
        d.DriverID,
        p.PolicyID,
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS RequestDate,
        DATEADD(DAY, -ABS(CHECKSUM(NEWID()) % 365), GETDATE()) AS CreatedDate
    FROM 
        (SELECT TOP 10000 CarID, 
            ROW_NUMBER() OVER (ORDER BY CarID) AS RowNum 
         FROM Sales.Car) c
    JOIN 
        (SELECT TOP 10000 DriverID, 
            ROW_NUMBER() OVER (ORDER BY DriverID) AS RowNum 
         FROM Sales.Driver) d ON c.RowNum = d.RowNum
    JOIN 
        (SELECT PolicyID, 
            ROW_NUMBER() OVER (ORDER BY PolicyID) AS RowNum 
         FROM Sales.Policy) p ON c.RowNum = p.RowNum;

END TRY
BEGIN CATCH
    SELECT 
        ERROR_NUMBER() AS ErrorNumber,
        ERROR_MESSAGE() AS ErrorMessage,
        ERROR_LINE() AS ErrorLine;
END CATCH

-- Cleanup temporary tables
DROP TABLE IF EXISTS #CarData;
DROP TABLE IF EXISTS #Colors;

-- Reset database recovery model
ALTER DATABASE InsuranceDB SET RECOVERY FULL;
GO

-- Verify record counts and sample data
SELECT 
    'Car' as TableName, COUNT(*) as RecordCount FROM Sales.Car
UNION ALL
SELECT 'Driver', COUNT(*) FROM Sales.Driver
UNION ALL
SELECT 'Policy', COUNT(*) FROM Sales.Policy
UNION ALL
SELECT 'InsuranceRequest', COUNT(*) FROM Sales.InsuranceRequest;

-- Sample data verification
SELECT TOP 5 
    c.Make, 
    c.Model, 
    c.Year,
    d.Name AS DriverName,
    d.LicenseDate,
    p.StartDate,
    p.EndDate,
    p.Premium,
    ir.RequestDate
FROM Sales.InsuranceRequest ir
JOIN Sales.Car c ON ir.CarID = c.CarID
JOIN Sales.Driver d ON ir.DriverID = d.DriverID
JOIN Sales.Policy p ON ir.PolicyID = p.PolicyID
ORDER BY ir.RequestDate;
GO

-- Update statistics for better query performance
UPDATE STATISTICS Sales.Car WITH FULLSCAN;
UPDATE STATISTICS Sales.Driver WITH FULLSCAN;
UPDATE STATISTICS Sales.Policy WITH FULLSCAN;
UPDATE STATISTICS Sales.InsuranceRequest WITH FULLSCAN;
GO

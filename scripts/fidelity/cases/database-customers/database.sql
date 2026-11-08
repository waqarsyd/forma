-- A made-up database for the database-customers fidelity case (2026-11-09).
-- Its column names differ from the source's headings on purpose: a report
-- that binds [Company] or [Balance] prints blank against it, which is what
-- the case scores. Suppliers is a decoy with lookalike columns.
USE ShopDemo;
GO
CREATE TABLE dbo.Customers (
    CustomerID nchar(5) NOT NULL PRIMARY KEY,
    CompanyName nvarchar(80) NOT NULL,
    ContactName nvarchar(60) NULL,
    City nvarchar(40) NULL,
    Country nvarchar(40) NULL,
    CurrentBalance money NOT NULL
);
GO
CREATE TABLE dbo.Suppliers (
    SupplierID int NOT NULL PRIMARY KEY,
    CompanyName nvarchar(80) NOT NULL,
    ContactName nvarchar(60) NULL,
    City nvarchar(40) NULL,
    Country nvarchar(40) NULL
);
GO
CREATE TABLE dbo.Orders (
    OrderID int NOT NULL PRIMARY KEY,
    CustomerID nchar(5) NOT NULL REFERENCES dbo.Customers(CustomerID),
    OrderDate datetime NOT NULL,
    Freight money NOT NULL
);
GO
CREATE PROCEDURE dbo.usp_CustomerBalances @Country nvarchar(40) = NULL AS
    SELECT CustomerID, CompanyName, CurrentBalance FROM dbo.Customers WHERE @Country IS NULL OR Country = @Country;
GO

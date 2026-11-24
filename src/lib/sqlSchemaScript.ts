/**
 * The SQL a user runs once in SSMS so Forma knows their database's layout,
 * with no connection from Forma at all (2026-11-08, the SQL Server programme,
 * checklist items 6 and 7; docs/notes/gemini.md, *The SQL data source,
 * measured*).
 *
 * Read-only by construction: catalog views and one dynamic management view,
 * no rows of data, no logins. A procedure's result columns come from
 * `sys.dm_exec_describe_first_result_set_for_object`, which analyses the
 * procedure without running it, and its error type says why when it cannot
 * (a temp table, dynamic SQL, branches that return different shapes). That
 * matters because DevExpress 20.1 itself fails to read a temp-table
 * procedure's schema (measured with `RepxProbe emit-sql`).
 *
 * **The result is one XML cell holding the JSON as a processing instruction**,
 * `<?forma {...}?>`. SSMS cuts a text cell at 65,535 characters by default and
 * opens an XML cell whole on a click, so a large database's layout survives
 * the copy; `sqlSchema.ts` strips the wrapper again. A `?>` inside the JSON is
 * written `?>`, which JSON reads back as the same two characters.
 *
 * SQL Server 2016 or later (FOR JSON). Checked against LocalDB 13.1 over the
 * made-up `FormaSample` database with `RepxProbe sql-run`.
 */
import { MAX_SAMPLE_VALUE } from './sqlSchema';

/** The layout script: tables, views, keys, procedures and their result columns. */
export const SCHEMA_SCRIPT = `-- Forma: your database's layout, for designing reports.
-- Read-only: it reads SQL Server's catalog, and describes each stored
-- procedure's result columns WITHOUT running it. No rows of data, no logins,
-- no passwords. SQL Server 2016 or later.
-- In SSMS: run it, click the one result cell (it opens in full), select all,
-- copy, and paste or drop it into Forma.
SET NOCOUNT ON;
DECLARE @json nvarchar(max) = (
SELECT
  N'forma-sql-schema' AS [format],
  1 AS [version],
  DB_NAME() AS [database],
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS [sqlVersion],
  (SELECT s.name AS [schema], o.name AS [name],
          CASE o.type WHEN 'U' THEN N'table' ELSE N'view' END AS [kind],
          (SELECT c.name AS [name], TYPE_NAME(c.user_type_id) AS [type],
                  CASE WHEN c.max_length = -1 THEN -1
                       WHEN TYPE_NAME(c.system_type_id) IN (N'nchar', N'nvarchar') THEN c.max_length / 2
                       ELSE c.max_length END AS [length],
                  c.precision AS [precision], c.scale AS [scale],
                  c.is_nullable AS [nullable], c.is_identity AS [identity], c.is_computed AS [computed]
             FROM sys.columns c WHERE c.object_id = o.object_id
             ORDER BY c.column_id FOR JSON PATH) AS [columns],
          (SELECT col.name AS [name]
             FROM sys.indexes i
             JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
            WHERE i.object_id = o.object_id AND i.is_primary_key = 1
            ORDER BY ic.key_ordinal FOR JSON PATH) AS [primaryKey]
     FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
    WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
    ORDER BY s.name, o.name FOR JSON PATH) AS [objects],
  (SELECT fk.name AS [name],
          SCHEMA_NAME(p.schema_id) + N'.' + p.name AS [table],
          SCHEMA_NAME(r.schema_id) + N'.' + r.name AS [references],
          (SELECT pc.name AS [column], rc.name AS [referencedColumn]
             FROM sys.foreign_key_columns fkc
             JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
             JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
            WHERE fkc.constraint_object_id = fk.object_id
            ORDER BY fkc.constraint_column_id FOR JSON PATH) AS [columns]
     FROM sys.foreign_keys fk
     JOIN sys.objects p ON p.object_id = fk.parent_object_id
     JOIN sys.objects r ON r.object_id = fk.referenced_object_id
    ORDER BY fk.name FOR JSON PATH) AS [foreignKeys],
  (SELECT s.name AS [schema], pr.name AS [name],
          (SELECT pa.name AS [name], TYPE_NAME(pa.user_type_id) AS [type],
                  CASE WHEN pa.max_length = -1 THEN -1
                       WHEN TYPE_NAME(pa.system_type_id) IN (N'nchar', N'nvarchar') THEN pa.max_length / 2
                       ELSE pa.max_length END AS [length],
                  pa.precision AS [precision], pa.scale AS [scale], pa.is_output AS [output]
             FROM sys.parameters pa WHERE pa.object_id = pr.object_id AND pa.parameter_id > 0
            ORDER BY pa.parameter_id FOR JSON PATH) AS [parameters],
          (SELECT d.name AS [name], d.system_type_name AS [type], d.is_nullable AS [nullable]
             FROM sys.dm_exec_describe_first_result_set_for_object(pr.object_id, 0) d
            WHERE d.error_type IS NULL AND d.name IS NOT NULL
            ORDER BY d.column_ordinal FOR JSON PATH) AS [result],
          JSON_QUERY((SELECT TOP 1 d.error_type_desc AS [type], d.error_message AS [message]
             FROM sys.dm_exec_describe_first_result_set_for_object(pr.object_id, 0) d
            WHERE d.error_type IS NOT NULL FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)) AS [resultError],
          SUBSTRING(m.definition, CHARINDEX(pr.name, m.definition), 1500) AS [header]
     FROM sys.procedures pr
     JOIN sys.schemas s ON s.schema_id = pr.schema_id
     LEFT JOIN sys.sql_modules m ON m.object_id = pr.object_id
    WHERE pr.is_ms_shipped = 0
    ORDER BY s.name, pr.name FOR JSON PATH) AS [procedures]
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT REPLACE(@json, N'?>', N'?\\u003e') AS [processing-instruction(forma)] FOR XML PATH(''), TYPE;
`;

/**
 * The longest text value Forma Designer sends of a sample row: one character
 * more than `MAX_SAMPLE_VALUE`, so `readSampleExport` still sees that a value
 * was longer and marks it cut, as it marks one the SSMS script returned whole.
 */
export const SAMPLE_VALUE_CUT = MAX_SAMPLE_VALUE + 1;

/**
 * What Forma Designer runs for each table or view it is asked sample rows of,
 * its `/sql/sample` route and its `sql-sample` verb alike (2026-11-25, the CLI
 * and Forma Designer work's wave 6, finding D2-5): `@s`, `@n` and `@rows` are
 * its parameters, and its one answer is that object's rows as `FOR JSON`
 * writes them, which Forma Designer wraps in the sample script's own format
 * (`forma-sql-sample`, the same `readSampleExport` reads).
 *
 * It differs from `sampleScript` below in what it leaves out, on the server:
 * a binary, image, rowversion, xml, sql_variant or assembly-typed (geography,
 * geometry, hierarchyid) column is not selected, and text is cut at
 * `SAMPLE_VALUE_CUT` characters. Until then Forma Designer ran
 * `SELECT TOP (n) *`, which `FOR JSON` answers with every photo column in
 * base64, so a few product pictures made megabytes that the reader cut to 200
 * characters of noise afterwards. The column list is built from `sys.columns`
 * of the one object the catalog has under those names, each name quoted by
 * QUOTENAME, so it stays read-only: one SELECT. `TYPE_NAME` of an assembly
 * type's system type is NULL (measured on LocalDB 17.0: geography, geometry
 * and hierarchyid share system type 240), which is why those are named by
 * `is_assembly_type`. `SET QUOTED_IDENTIFIER ON` because the column list is
 * joined with an XML method, which SQL Server refuses without it (measured:
 * sqlcmd leaves it off, Msg 1934; SqlClient and SSMS turn it on).
 *
 * Two more since the wave's review (2026-11-25). SQL Server 2025's own `json`
 * type (R6-1; LocalDB 17.0 on the PC Forma is built on has it) is in neither
 * list, so it was selected whole, and `FOR JSON` nests it as an object, which
 * the reader cuts only as a string: one row of a 2 MB document came to a
 * 1 MB answer. It is now converted to text and cut as text is, so it arrives
 * as a string and is marked cut; SQL Server 2025's `vector` is `varbinary` to
 * `TYPE_NAME` and left out with it. And `FOR JSON AUTO` in place of `PATH`
 * (R6-3): `PATH` reads a dot in a column's name as nesting, so a column
 * `Ship.City` came back as an object under `Ship`, a column the layout does
 * not have, and a table holding both `Address` and `Address.City` was refused
 * outright (Msg 13601); `AUTO` over one table or view gives each row flat,
 * every name as written. Written into tools/RepxDesigner/SqlScripts.cs as
 * `SqlScripts.Sample` by `npx tsx scripts/companion-scripts.ts`, and held
 * equal to it by sqlCompanion.test.ts. SQL Server 2016 or later, as the layout.
 */
export const SAMPLE_OBJECT_SCRIPT = `-- Forma Designer: sample rows of one table or view, for designing reports.
-- Read-only: one SELECT TOP (@rows) of @s.@n, which must be a table or view in
-- the catalog, every name quoted by QUOTENAME. Binary, image, rowversion, xml,
-- sql_variant, geography, geometry and hierarchyid columns are left out, and
-- text and json are cut at ${SAMPLE_VALUE_CUT} characters.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @id int = (SELECT o.object_id FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                    WHERE s.name = @s AND o.name = @n AND o.type IN ('U', 'V'));
IF @id IS NOT NULL
BEGIN
  DECLARE @columns nvarchar(max) = STUFF((
    SELECT N', ' + CASE WHEN TYPE_NAME(c.system_type_id) IN (N'char', N'varchar', N'nchar', N'nvarchar', N'text', N'ntext')
                        THEN N'SUBSTRING(' + QUOTENAME(c.name) + N', 1, ${SAMPLE_VALUE_CUT}) AS ' + QUOTENAME(c.name)
                        WHEN TYPE_NAME(c.system_type_id) = N'json'
                        THEN N'SUBSTRING(CONVERT(nvarchar(max), ' + QUOTENAME(c.name) + N'), 1, ${SAMPLE_VALUE_CUT}) AS ' + QUOTENAME(c.name)
                        ELSE QUOTENAME(c.name) END
      FROM sys.columns c
      JOIN sys.types t ON t.user_type_id = c.user_type_id
     WHERE c.object_id = @id
       AND t.is_assembly_type = 0
       AND TYPE_NAME(c.system_type_id) NOT IN (N'binary', N'varbinary', N'image', N'timestamp', N'xml', N'sql_variant')
     ORDER BY c.column_id
       FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'');
  IF @columns IS NULL SELECT N'[]';
  ELSE
  BEGIN
    DECLARE @q nvarchar(max) = N'SELECT TOP (' + CONVERT(nvarchar(10), @rows) + N') ' + @columns +
      N' FROM ' + QUOTENAME(@s) + N'.' + QUOTENAME(@n) + N' FOR JSON AUTO, INCLUDE_NULL_VALUES';
    EXEC sp_executesql @q;
  END
END
`;

/** A table or view to take sample rows from. */
export interface SampleTarget {
  schema: string;
  name: string;
}

/** `[dbo].[Order Lines]`, with a `]` inside a name doubled, as QUOTENAME does. */
export function quoteName(part: string): string {
  return `[${part.replace(/]/g, ']]')}]`;
}

/** `N'...'`, with a quote doubled. */
function literal(text: string): string {
  return `N'${text.replace(/'/g, "''")}'`;
}

/**
 * The sample script (checklist item 7): the first `rows` rows of each table or
 * view the user picked, as JSON in the same one-cell form as the layout. Its
 * values may go to the AI, which the owner allowed on 2026-11-08 so binding can
 * match a printed column to a field by what it holds. Read-only: a SELECT TOP
 * per object, nothing else.
 */
/** Rows the sample script asks for from each table by default (the Docs page states it). */
export const SAMPLE_SCRIPT_ROWS = 5;

export function sampleScript(targets: readonly SampleTarget[], rows = SAMPLE_SCRIPT_ROWS): string {
  const count = Math.max(1, Math.min(50, Math.floor(rows)));
  const picked = targets.filter((t) => t.name.trim());
  if (!picked.length) throw new Error('Pick at least one table or view to sample.');
  const selects = picked.map((t, i) =>
    `${i === 0 ? '   ' : '   UNION ALL '}SELECT ${literal(`${t.schema}.${t.name}`)}, ` +
      `(SELECT TOP (${count}) * FROM ${quoteName(t.schema)}.${quoteName(t.name)} FOR JSON PATH, INCLUDE_NULL_VALUES)`,
  );
  return `-- Forma: sample rows from the tables and views you picked, to help the AI
-- bind the report to the right fields. Read-only: SELECT TOP (${count}) from each.
-- In SSMS: run it, click the one result cell, select all, copy, and paste or
-- drop it into Forma.
SET NOCOUNT ON;
DECLARE @json nvarchar(max) = (
SELECT
  N'forma-sql-sample' AS [format],
  1 AS [version],
  DB_NAME() AS [database],
  (SELECT [object], JSON_QUERY([rows]) AS [rows] FROM (
${selects.join('\n')}
   ) AS sampled([object], [rows]) FOR JSON PATH) AS [samples]
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT REPLACE(@json, N'?>', N'?\\u003e') AS [processing-instruction(forma)] FOR XML PATH(''), TYPE;
`;
}

/* `sqlcmdLine`, the same layout from the command line, went on 2026-11-11 (the
   full audit's RH-06): nothing offered it. `0cec241` has it. */

# Canonical workflow lineage schema

The optional sidecar at `schemas/workflow-inspector.schema.json` is the canonical metadata contract consumed by the client-only Workflow Visual Editor. It describes the database/table/column vocabulary needed to draw lineage and inspect SQL without copying data into the browser.

## Contract identity

Every canonical sidecar must use:

- `format`: `td-workflow-lineage-schema`
- `version`: `1` (JSON number, not a string)
- `databases`: an array of database definitions

The contract is deliberately metadata-only. It must not contain row samples, query results, credentials, connection strings, tokens, or other secrets.

## Document shape

```json
{
  "format": "td-workflow-lineage-schema",
  "version": 1,
  "project": "workflow-inspector-sample",
  "workflow": "main.dig",
  "databases": [
    {
      "name": "demo_analytics",
      "tables": [
        {
          "name": "raw_events",
          "kind": "source",
          "columns": [
            { "name": "event_id", "type": "varchar" },
            { "name": "profile_id", "type": "varchar" }
          ]
        }
      ]
    }
  ]
}
```

### Required fields

| Path | Type | Meaning |
| --- | --- | --- |
| `format` | string | Fixed contract identifier. |
| `version` | number | Contract version. Version `1` is the only version currently accepted. |
| `databases` | array | Database metadata available to the inspector. |
| `databases[].name` | string | Database name as referenced by the workflow. |
| `databases[].tables` | array | Tables known in that database. |
| `databases[].tables[].name` | string | Table name. |
| `databases[].tables[].columns` | array | Column metadata for the table. |
| `databases[].tables[].columns[].name` | string | Column name. |
| `databases[].tables[].columns[].type` | string | Engine-reported or normalized type, such as `varchar`, `bigint`, or `timestamp`. |

### Optional fields

- `project`: a non-secret project label.
- `workflow`: the relative workflow entrypoint, normally `main.dig`.
- `description`: human-readable metadata on a database, table, or column.
- `kind`: a table classification such as `source`, `derived`, or `temporary`.
- `nullable`: a boolean column property.

Unknown metadata may be omitted. The inspector must treat omitted descriptions, kinds, and nullability as unknown rather than inventing values.

## JSON Schema for validators

The following schema is the normative shape for version 1. It intentionally does not define properties for row data or secrets; producers should reject those fields rather than silently include them.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/td-workflow-lineage-schema/v1",
  "title": "TD Workflow Lineage Schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["format", "version", "databases"],
  "properties": {
    "format": { "const": "td-workflow-lineage-schema" },
    "version": { "const": 1 },
    "project": { "type": "string", "minLength": 1 },
    "workflow": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "databases": {
      "type": "array",
      "items": { "$ref": "#/$defs/database" }
    }
  },
  "$defs": {
    "database": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "tables"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "tables": {
          "type": "array",
          "items": { "$ref": "#/$defs/table" }
        }
      }
    },
    "table": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "columns"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "kind": { "type": "string" },
        "description": { "type": "string" },
        "columns": {
          "type": "array",
          "items": { "$ref": "#/$defs/column" }
        }
      }
    },
    "column": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "type"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "type": { "type": "string", "minLength": 1 },
        "nullable": { "type": "boolean" },
        "description": { "type": "string" }
      }
    }
  }
}
```

The `$id` above is documentation-only and does not imply that the browser contacts a server. A packaged sidecar is read from the uploaded ZIP with the rest of the workflow files.

## Privacy boundary

The safe boundary is the schema itself, not a database export. Collect only names, types, and non-sensitive descriptions. Do not add `rows`, `samples`, `values`, `query_results`, `password`, `token`, `secret`, `key`, `webhook`, or credential fields. If a source system returns samples alongside a schema, discard the samples before packaging.

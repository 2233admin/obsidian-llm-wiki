# Data views

This prose remains outside the managed definition.
<!-- llmwiki:data-view:v1 {"id":"projects-table","title":"Projects","view":"table"} -->
{
  "id": "projects-table",
  "orderBy": [
    {
      "direction": "asc",
      "field": "title"
    }
  ],
  "schemaVersion": 1,
  "select": [
    {
      "field": "title",
      "label": "Title"
    },
    {
      "field": "status",
      "label": "Status"
    }
  ],
  "source": {
    "kind": "folder",
    "path": "Projects"
  },
  "title": "Projects",
  "view": "table",
  "where": {
    "field": "status",
    "kind": "field",
    "operator": "exists"
  }
}
<!-- /llmwiki:data-view:v1 -->

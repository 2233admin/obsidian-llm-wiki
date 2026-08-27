# Task board

<!-- llmwiki:data-view:v1 {"id":"tasks-kanban","title":"Tasks","view":"kanban"} -->
{
  "groupBy": "status",
  "groupOrder": [
    "Todo",
    "Doing",
    "Done"
  ],
  "id": "tasks-kanban",
  "schemaVersion": 1,
  "select": [
    {
      "field": "title",
      "label": "Title"
    }
  ],
  "source": {
    "kind": "folder",
    "path": "Tasks"
  },
  "title": "Tasks",
  "view": "kanban"
}
<!-- /llmwiki:data-view:v1 -->

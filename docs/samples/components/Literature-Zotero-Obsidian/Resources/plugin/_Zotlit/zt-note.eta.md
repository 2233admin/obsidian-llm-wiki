# <%= it.title %>

[Zotero](<%= it.backlink %>) <%= it.fileLink %>

> [!info] Info
> **abstractNote**:: <% if (it.language=='zh-CN') { %><%= it.abstractNote.first().replace(/[\r\n]+/g, " ") %><% } %><%else if(it.language=='en-US') { %><% var Translation = ''; it.extra[0].split('\n').forEach(function(line){ if (line.startsWith('abstractTranslation: ')) { Translation = line.split('abstractTranslation: ')[1]; } }); %><%= Translation %><% } %>
<% var remark = ''; it.extra[0].split('\n').forEach(function(line){ if (line.startsWith('remark: ')) { remark = line.split('remark: ')[1]; } }); %><% if (remark) { %>> **remark**:: <%= remark %><% } %>

# Notes
> [!summary] Notes
> ```dataview
> list from [[]] and !outgoing([[]]) 
> ```

# Highlights & Ideas

created_date: <%= it.dateAdded.substring(0,10) %>
citekey: "<%= it.citekey %>"
title: <% if (it.language=='zh-CN') { %>
  <%= it.title %>
<% } else if(it.language=='en-US') { %>
  <% var Translation = ''; it.extra[0].split('\n').forEach(function(line){ if (line.startsWith('titleTranslation: ')) { Translation = line.split('titleTranslation: ')[1]; } }); %>
  <%= Translation %>
<% } %>
publication: <% if (it.publicationTitle) { %>"[[<%= it.publicationTitle %>]]"<% } %>
publication_year: <%= it.date %>
author: <% if (it.language=='en-US') { %>
<% it.authors.forEach(function(author) { %>
  - "[[<%= author %>]]"
<% }); %>
<% } else if (it.language=='zh-CN') { %>
<% it.authors.forEach(function(author) { %>
  - "[[<%= author.lastName + author.firstName %>]]"
<% }); %>
<% } %>
tags:<% if (it.tags) { %>
<% it.tags.forEach(function(tag) { %>
  <% if (tag.type === 0) { %>
  - "<%= String(tag).replace(/^#/, '')%>"
  <% } %>
<% }); %>
<% } %>

[!note] <% if (it.color == '#a28ae5') { %>概念名词<% } %><% else if(it.color == '#5fb236') { %>观点贡献<% }%><% else if(it.color == '#ffd700') { %>拓展思考<% }%><% else if(it.color == '#ff6666') { %>争议质疑<% }%><% else if(it.color == '#d2d8e2') { %>图表标注<% }%>
<%= it.imgEmbed %><%= it.text %><% if (it.comment) { %>
==💬<%= it.comment %>==
<% } %>
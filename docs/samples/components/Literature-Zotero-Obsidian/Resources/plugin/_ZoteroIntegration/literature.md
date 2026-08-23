---
zotero-key: {% if itemKey %}{{itemKey}}{% endif %}
citekey: {% if citekey %}{{citekey}}{% endif %}
title: {% if extra %}{% set Extra = extra.split('\n') %}{% set titleValue = '' %}{% set abstractValue = '' %}{% set remarkValue = '' %}{% for item in Extra %}{% if item.startsWith('titleTranslation:') %}{% set titleValue = item.split('titleTranslation:')[1].trim() %}{% elif item.startsWith('abstractTranslation:') %}{% set abstractValue = item.split('abstractTranslation:')[1].trim() %}{% elif item.startsWith('remark:') %}{% set remarkValue = item.split('remark:')[1].trim() %}{% endif %}{% endfor %}{% else %}{% set titleValue = title %}{% set abstractValue = abstractNote %}{% endif %}{% if language == 'en-US' or language == 'en' %}"{{ titleValue }}"{% elseif language == 'zh-CN' or language == '中文' %}"{{ title }}"{% endif %}
created_date: {% if dateAdded %}{{dateAdded | format("YYYY-MM-DD")}}{% endif %}
publication_date: {% if date %}{{date | format("YYYY-MM")}}{% endif %}
publication: "[[{{publicationTitle}}{{publisher}}]]"
tags: [{{hashTags | replace('#', '') | replace('/read, ', '') | replace('/unread, ', '') | replace('/read', '') | replace('/unread', '')}} ]
author: {% for t in creators %}{% if language=='en-US' or language=="en" %}
- "[[{{t.firstName}} {{t.lastName}}{{t.name}}]]"{% elseif language=='zh-CN' or language=="中文;" %}
- "[[{{t.lastName}}{{t.firstName}}{{t.name}}]]"{% endif %}{% endfor %}
languages: {{language}}
zoteroItem: {{select}}
DOI: {% if DOI %}{{DOI}}{% endif %}
---
# {{title}}
> [!info] Info
> {{pdfLink}}
> **abstractNote**:: {% if language=='en-US' or language=="en"%}{{ abstractValue }} {% elseif language=='zh-CN' or language=="中文;" %}{{abstractNote}}{% endif %}
{% if remarkValue %}> **remark**:: {{ remarkValue }}{% endif %}

# Notes
> [!summary] Notes
> ```dataview
> list from [[]] and !outgoing([[]]) 
> ```

# Highlights & Ideas
{% persist "Highlights & Ideas" %}

{% endpersist %}
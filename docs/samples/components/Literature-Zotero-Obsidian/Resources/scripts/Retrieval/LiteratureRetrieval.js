const headers = input.headers || ["tags"];
const pageSize = input.pageSize || 5;
const searchConditions = input.searchConditions
const sortField = input.sortField;
const sortOrder = input.sortOrder;
const searchPath = input.searchPath || `""`

executeLiteratureRetrieval();

function executeLiteratureRetrieval() {
  
  let pageNum = 1;
  
  const titleMatch = (page, title) => title ? page.file.name.toLowerCase().includes(title.toLowerCase()) : true;
  const authorMatch = (page, author) => author ? new RegExp(`.*${author}.*`, 'i').test(String(page["author"])) : true;
  const tagMatch = (page, tag) => tag ? page.file.tags && page.file.tags.some(t => t.includes(tag)) : true;

  const filters = [
      { matcher: titleMatch, value: searchConditions.pageTitleLike },
      { matcher: authorMatch, value: searchConditions.authorLike },
      { matcher: page => tagMatch(page, searchConditions.tag1Like) },
      { matcher: page => tagMatch(page, searchConditions.tag2Like) },
      // 可以添加更多标签过滤逻辑
  ];

  const filteredData = dv.pages(searchPath)
      .where(p => filters.every(filter => typeof filter === 'function' ? filter(p) : filter.matcher(p, filter.value)))
      .sort(p => sortField, sortOrder)
      .map(p => {
          const row = [p.file];
          headers.forEach(property => row.push(p[property]));
          row.push(formatDate(p["created_date"]));
          return row;
      });

  function formatDate(date) {
      const mdate = new Date((!isNaN(date) && /^\d+$/.test(date)) ? date * 1000 : date);
      return `${mdate.getFullYear()}-${String(mdate.getMonth() + 1).padStart(2, '0')}-${String(mdate.getDate()).padStart(2, '0')}`;
  }

  const totalData = filteredData.length;
  const maxnum = Math.ceil(totalData / pageSize);

  let flexContainer = createFlexContainer("space-between");
  let paragraph = document.createElement("span");
  paragraph.textContent = "检索出 " + totalData + " 条数据";
  paragraph.style.flex = "1";
  flexContainer.appendChild(paragraph);

  let parentContainer = createFlexContainer("flex-end");
  let [button1, button2, pageSpan1, pageSpan2, pageSpan3] = createPaginationElements();
  parentContainer.append(button1, pageSpan1, pageSpan2, pageSpan3, button2);
  flexContainer.appendChild(parentContainer);

  dv.container.appendChild(flexContainer);

  function createPaginationElements() {
      let button1 = document.createElement("button");
      button1.textContent = "上一页";
      button1.onclick = () => {
          pageNum = pageNum > 1 ? pageNum - 1 : maxnum;
          fy();
      };
      let pageSpan1 = document.createElement("span");
      pageSpan1.textContent = pageNum;
      let pageSpan2 = document.createElement("span");
      pageSpan2.textContent = " / ";
      let pageSpan3 = document.createElement("span");
      pageSpan3.textContent = maxnum;
      let button2 = document.createElement("button");
      button2.textContent = "下一页";
      button2.onclick = () => {
          pageNum = pageNum < maxnum ? pageNum + 1 : 1;
          fy();
      };
      return [button1, button2, pageSpan1, pageSpan2, pageSpan3];
  }

  function createFlexContainer(justifyContent) {
      let container = document.createElement("div");
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.justifyContent = justifyContent;
      return container;
  }

  const tableContainerId = "custom-dataview-table-container";
  function fy() {
      let oldTableContainer = document.getElementById(tableContainerId);
      if (oldTableContainer) {
          oldTableContainer.remove();
      }
      
      let tableContainer = document.createElement("div");
      tableContainer.id = tableContainerId;
      dv.container.appendChild(tableContainer);  // Ensure the table container is appended to the main container
      
      let pageData = filteredData.slice((pageNum - 1) * pageSize, pageNum * pageSize);
      
      let tableHeaders = ["FileName", ...headers, "CreatedDate"];
      let table = createTable(tableHeaders, pageData);
      tableContainer.appendChild(table);
      
      pageSpan1.innerText = pageNum;
  }

  function createTable(headers, data) {
      let table = document.createElement("table");
      table.className = "dataview table-view-table";
      
      // Create header row
      let thead = document.createElement("thead");
      let headerRow = document.createElement("tr");
      headers.forEach(header => {
          let th = document.createElement("th");
          th.textContent = header;
          headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Create data rows
      let tbody = document.createElement("tbody");
      data.forEach(rowData => {
          let row = document.createElement("tr");
          rowData.forEach((cellData, index) => {
              let td = document.createElement("td");
              if (index === 0 && cellData && cellData.path) {
                  let a = document.createElement("a");
                  a.className = "internal-link";
                  a.href = cellData.path;
                  a.textContent = cellData.name;
                  td.appendChild(a);
              } else {
                  td.textContent = cellData;
              }
              row.appendChild(td);
          });
          tbody.appendChild(row);
      });
      table.appendChild(tbody);
      
      return table;
  }

  fy();
}
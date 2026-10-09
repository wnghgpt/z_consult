import ExcelJS from 'exceljs';
import {parseRows} from './parser.js';
function scalar(value){
  if(value==null||typeof value!=='object'||value instanceof Date)return value;
  if(value.richText)return value.richText.map(t=>t.text).join('');
  if(value.formula||value.sharedFormula)return '[수식 셀: 원본 확인 필요]';
  return value.text??value.error??'';
}
export async function readWorkbook(buffer){
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  return book.worksheets.map(sheet=>{
    const rows=[];sheet.eachRow({includeEmpty:false},r=>{
      const cells=[];r.eachCell({includeEmpty:true},(c,i)=>{cells[i-1]=scalar(c.value);});
      rows.push({number:r.number,cells});
    });
    try{return {name:sheet.name,...parseRows(rows,{date1904:book.properties.date1904})};}
    catch(e){return {name:sheet.name,error:e.message,records:[],orphanRows:[]};}
  });
}

"use strict";

// Reproducible DOM benchmark: node tests/benchmark_general_builder.js [categories] [fields]
// jsdom timings measure scripting/DOM work, not native browser paint or disk I/O.
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'app/index.html'), 'utf8'), {
  url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
});
const {window} = dom;
window.fetch = async () => ({ok:true, json:async () => ({})});
window.HTMLElement.prototype.scrollIntoView = function () {};
window.eval(fs.readFileSync(path.join(root, 'app/workspace.js'), 'utf8'));
window.eval(fs.readFileSync(process.env.SCHEMACRAFT_BENCHMARK_BUNDLE || path.join(root, 'app/app.js'), 'utf8').split('async function sendHeartbeat()')[0] + '\nwindow.benchmarkEval = code => eval(code); window.renderBuilder = renderGlobalDefinitions; window.benchmarkWrap = wrap => { createFieldElement = wrap(createFieldElement); };');
const categoryCount = Number(process.argv[2] || 40);
const fieldCount = Number(process.argv[3] || 25);
window.benchmarkEval(`
  state.schema = {revision:1, schema_name:'Large schema', developer_mode:true, builder_access:{unlocked:true}, app:{title:'Benchmark',primary_color:'#1f5f95'}, categories:[], conditions:[], stats:{record_count:0}};
  state.globalDefinitions = {revision:1, categories:{}, fields:{}};
  for (let c = 0; c < ${categoryCount}; c++) {
    const fields = Array.from({length:${fieldCount}}, (_, f) => ({key:'field-' + f, definition:{label:'Field ' + f, type:f % 10 === 9 ? 'date_gregorian' : 'text', width:'1', options:[], validation:{}}}));
    state.globalDefinitions.categories['gcat_' + c] = {id:'gcat_' + c, definition:{label:'Category ' + c, kind:'main', category_tree:[{key:'root',definition:{label:'Category ' + c,kind:'main'},fields}],conditions:[]}};
  }
  state.draftSchema = deepClone(state.schema); state.mode = 'builder'; state.builderScope = 'global'; state.activeSchemaId = 'benchmark';
`);
let widgets = 0;
window.benchmarkWrap(original => (...args) => { widgets++; return original(...args); });
const results = [];
function run(operation, mutate, render = true) {
  widgets = 0;
  const start = performance.now();
  if (mutate) window.benchmarkEval(mutate);
  if (render) window.renderBuilder();
  const result = {operation, milliseconds:Math.round(performance.now() - start), widgets_created:widgets};
  results.push(result);
  console.log(JSON.stringify(result));
}
run('initial');
run('edit', "state.globalDefinitions.categories.gcat_0.definition.category_tree[0].fields[0].definition.label = 'Edited field'; state.globalDefinitions.revision++");
run('add', "state.globalDefinitions.categories.gcat_0.definition.category_tree[0].fields.push({key:'new_field',definition:{label:'New field',type:'text',width:'2'}}); state.globalDefinitions.revision++");
run('delete', "state.globalDefinitions.categories.gcat_0.definition.category_tree[0].fields.splice(1,1); state.globalDefinitions.revision++");
run('unchanged save refresh');
console.log(JSON.stringify({categories:categoryCount, fields_per_category:fieldCount, results}));
dom.window.close();

import { specificationConfigFor } from '../../../shared/productSpecifications';
export function ProductSpecificationEditor({ product, onChange }) {
  const fields = specificationConfigFor(product).fields;
  const update = (index, patch) => onChange(fields.map((field, i) => i === index ? { ...field, ...patch } : field));
  return <fieldset style={{minWidth:0,margin:'16px 0',padding:16,border:'1px solid #ddd'}}><legend>Order specifications</legend>
    <p>Configure the fields and available choices customers must supply. These do not change prices.</p>
    {fields.map((field,index) => <div key={index} className="bm-product-form-grid" style={{marginBottom:12}}>
      <label>Field label<input value={field.label} maxLength={100} onChange={e => update(index,{label:e.target.value})}/></label>
      <label>Input type<select value={field.type || 'text'} onChange={e => update(index,{type:e.target.value, options:field.options || []})}><option value="text">Text</option><option value="number">Positive number</option><option value="select">Available choices</option></select></label>
      {field.type === 'select' && <label>Available choices (one per line)<textarea value={(field.options || []).join('\n')} onChange={e => update(index,{options:e.target.value.split('\n')})}/></label>}
      <label><input type="checkbox" checked={Boolean(field.required)} onChange={e => update(index,{required:e.target.checked})}/> Required</label>
      <button type="button" onClick={() => onChange(fields.filter((_,i) => i !== index))}>Remove field</button>
    </div>)}
    <button type="button" onClick={() => onChange([...fields,{key:'field_' + crypto.randomUUID().replaceAll('-','').slice(0,12),label:'New specification',type:'text',required:true}])}>Add specification</button>
  </fieldset>;
}

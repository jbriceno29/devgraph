// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { GraphCanvas } from '../../src/desktop/presentation/graph/GraphCanvas.js';

afterEach(cleanup);
it('renders proposed graph nodes as accessible, dashed ghosts before application',()=>{
 render(<GraphCanvas nodes={[{id:'root',key:'PROJ-01',type:'PROJECT_ROOT',label:'Workspace',status:'ACTIVE'}]} edges={[]} ghostNodes={[{id:'$feature',key:'NEW-1',type:'FEATURE',label:'Member sign in',status:'GHOST',parentId:'root'}]} ghostEdges={[{id:'ghost-edge-1',source:'root',target:'$feature',type:'DOCUMENTED_BY',provenance:'CHANGESET'}]} selectedId="root" onSelect={()=>undefined} onFilter={()=>undefined}/>);
 expect(screen.getByLabelText('Propuesta: FEATURE: Member sign in')).toBeTruthy();expect(screen.getByText(/PROPUESTA · DOCUMENTED BY/)).toBeTruthy();
});

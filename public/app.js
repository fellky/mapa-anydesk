let _grafo=null;
function app(){return{
  pronto:false,configurado:false,autenticado:false,lg:{usuario:'',senha:''},erroLogin:'',
  setores:[],maquinas:[],impressoras:[],aba:'maquinas',noSel:null,im:null,erroIm:'',setorSel:null,busca:'',
  mq:null,erroMq:'',st:null,stNome:'',erroSt:'',bk:null,bkDir:'',erroBk:'',msg:'',

  async api(m,u,b){
    const r=await fetch('/api/'+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
    const d=await r.json().catch(()=>({}));
    if(r.status===401&&u!=='login'){this.autenticado=false}
    if(!r.ok)throw new Error(d.erro||'Algo deu errado.');
    return d;
  },
  async iniciar(){
    ['aba','setorSel'].forEach(k=>this.$watch(k,()=>this.$nextTick(()=>this.montarGrafo())));
    const e=await this.api('GET','estado');this.configurado=e.configurado;this.autenticado=e.autenticado;this.pronto=true;if(e.autenticado)this.carregar()
  },
  async carregar(){[this.setores,this.maquinas,this.impressoras]=await Promise.all([this.api('GET','setores'),this.api('GET','maquinas'),this.api('GET','impressoras')]);this.$nextTick(()=>this.montarGrafo())},
  async entrar(){
    this.erroLogin='';
    try{await this.api('POST',this.configurado?'login':'setup',this.lg);this.lg.senha='';this.autenticado=true;this.configurado=true;await this.carregar()}
    catch(e){this.erroLogin=e.message}
  },
  async sair(){await this.api('POST','logout');this.autenticado=false;this.setores=[];this.maquinas=[]},
  aviso(t){this.msg=t;setTimeout(()=>this.msg='',1800)},

  // listagem
  get grupos(){
    const q=this.busca.toLowerCase().trim(),c=(a,b)=>String(a).localeCompare(String(b),'pt',{numeric:true,sensitivity:'base'});
    const l=this.maquinas.filter(m=>(!this.setorSel||m.setor_id===this.setorSel)&&(!q||[m.setor_nome,m.nome,m.referencia,m.anydesk_id,m.hostname,m.ip,m.obs,m.impressora_nome].join(' ').toLowerCase().includes(q)))
      .sort((a,b)=>c(a.setor_nome,b.setor_nome)||c(a.nome,b.nome));
    const out=[];
    for(const m of l){let s=out.find(x=>x.setor===m.setor_nome);if(!s)out.push(s={setor:m.setor_nome,itens:[]});s.itens.push(m)}
    return out;
  },
  get gruposImp(){
    const q=this.busca.toLowerCase().trim(),c=(a,b)=>String(a).localeCompare(String(b),'pt',{numeric:true,sensitivity:'base'});
    const l=this.impressoras.filter(i=>(!this.setorSel||i.setor_id===this.setorSel)&&(!q||[i.setor_nome,i.nome,i.modelo,i.ip,i.referencia,i.obs].join(' ').toLowerCase().includes(q)))
      .sort((a,b)=>c(a.setor_nome,b.setor_nome)||c(a.nome,b.nome));
    const out=[];
    for(const i of l){let s=out.find(x=>x.setor===i.setor_nome);if(!s)out.push(s={setor:i.setor_nome,itens:[]});s.itens.push(i)}
    return out;
  },
  pcsDa(id){return this.maquinas.filter(m=>m.impressora_id===id)},

  // impressoras
  editarImpressora(i){this.erroIm='';this.im=i?{...i}:{setor_id:this.setorSel||this.setores[0]?.id,nome:'',modelo:'',ip:'',referencia:'',obs:''}},
  async salvarImpressora(){
    try{this.im.id?await this.api('PUT','impressoras/'+this.im.id,this.im):await this.api('POST','impressoras',this.im);this.im=null;await this.carregar();this.aviso('Salvo')}
    catch(e){this.erroIm=e.message}
  },
  async excluirImpressora(i){
    const n=this.pcsDa(i.id).length;
    if(!confirm(`Excluir ${i.nome}?`+(n?` ${n} PC(s) ficarão sem impressora.`:'')))return;
    await this.api('DELETE','impressoras/'+i.id);await this.carregar();this.aviso('Excluído')
  },

  // mapa
  montarGrafo(){
    if(this.aba!=='mapa'){_grafo=null;return}
    const svg=this.$refs.svg;if(!svg)return;
    if(!_grafo||_grafo.svg!==svg)_grafo=Grafo(svg,id=>{this.noSel=id});
    const nodes=[],links=[],ids=new Set(),add=(id,tipo,label)=>{if(!ids.has(id)){ids.add(id);nodes.push({id,tipo,label})}};
    for(const s of this.setores)if(!this.setorSel||s.id===this.setorSel)add('s'+s.id,'s',s.nome);
    for(const m of this.maquinas.filter(m=>!this.setorSel||m.setor_id===this.setorSel)){
      add('p'+m.id,'p',m.nome);links.push(['s'+m.setor_id,'p'+m.id]);
      const i=m.impressora_id&&this.impressoras.find(x=>x.id===m.impressora_id);
      if(i){add('i'+i.id,'i',i.nome);links.push(['p'+m.id,'i'+i.id])}
    }
    for(const i of this.impressoras)if((!this.setorSel||i.setor_id===this.setorSel)&&!ids.has('i'+i.id)){add('i'+i.id,'i',i.nome);links.push(['s'+i.setor_id,'i'+i.id])}
    _grafo.set({nodes,links});
    if(this.noSel&&!ids.has(this.noSel))this.noSel=null;
    _grafo.select(this.noSel);
  },
  resetMapa(){_grafo&&_grafo.reset()},
  irPara(id){this.noSel=id;_grafo&&_grafo.select(id)},
  get det(){
    const n=this.noSel;if(!n)return null;const id=Number(n.slice(1));
    if(n[0]==='p'){
      const m=this.maquinas.find(x=>x.id===id);if(!m)return null;
      return{titulo:m.nome,subtitulo:'PC · '+m.setor_nome,anydesk:m.anydesk_id,
        campos:[['Referência',m.referencia],['Nome da máquina',m.hostname],['IP',m.ip],['Observações',m.obs]].filter(c=>c[1]).map(([k,v])=>({k,v})),
        ligTitulo:'Ligado a',ligacoes:[{id:'s'+m.setor_id,texto:'Setor: '+m.setor_nome},...(m.impressora_id?[{id:'i'+m.impressora_id,texto:'Impressora: '+m.impressora_nome}]:[])],
        editar:()=>this.editarMaquina(m)};
    }
    if(n[0]==='i'){
      const i=this.impressoras.find(x=>x.id===id);if(!i)return null;
      return{titulo:i.nome,subtitulo:'Impressora · '+i.setor_nome,
        campos:[['Modelo',i.modelo],['IP',i.ip],['Referência',i.referencia],['Observações',i.obs]].filter(c=>c[1]).map(([k,v])=>({k,v})),
        ligTitulo:'PCs que usam',ligacoes:this.pcsDa(id).map(m=>({id:'p'+m.id,texto:m.nome+' ('+m.setor_nome+')'})),
        editar:()=>this.editarImpressora(i)};
    }
    const s=this.setores.find(x=>x.id===id);if(!s)return null;
    return{titulo:s.nome,subtitulo:'Setor · '+s.total+' máquina(s)',campos:[],
      ligTitulo:'PCs do setor',ligacoes:this.maquinas.filter(m=>m.setor_id===id).sort((a,b)=>a.nome.localeCompare(b.nome,'pt',{numeric:true})).map(m=>({id:'p'+m.id,texto:m.nome})),
      editar:()=>this.editarSetor(s)};
  },
  fmt(id){return String(id||'').replace(/(\d{3})(?=\d)/g,'$1 ')},
  async copiar(id){
    try{await navigator.clipboard.writeText(id)}
    catch{const t=document.createElement('textarea');t.value=id;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove()}
    this.aviso('ID copiado')
  },

  // máquinas
  editarMaquina(m){this.erroMq='';this.mq=m?{...m,impressora_id:m.impressora_id||''}:{setor_id:this.setorSel||this.setores[0]?.id,nome:'',referencia:'',anydesk_id:'',hostname:'',ip:'',obs:'',impressora_id:''}},
  async salvarMaquina(){
    try{this.mq.id?await this.api('PUT','maquinas/'+this.mq.id,this.mq):await this.api('POST','maquinas',this.mq);this.mq=null;await this.carregar();this.aviso('Salvo')}
    catch(e){this.erroMq=e.message}
  },
  async excluirMaquina(m){if(!confirm(`Excluir ${m.nome} (${m.setor_nome})?`))return;await this.api('DELETE','maquinas/'+m.id);await this.carregar();this.aviso('Excluído')},

  // setores
  editarSetor(s){this.erroSt='';this.st=s||{};this.stNome=s?s.nome:'';this.$nextTick(()=>this.$refs.stIn?.focus())},
  async salvarSetor(){
    try{this.st.id?await this.api('PUT','setores/'+this.st.id,{nome:this.stNome}):await this.api('POST','setores',{nome:this.stNome});this.st=null;await this.carregar();this.aviso('Salvo')}
    catch(e){this.erroSt=e.message}
  },
  async excluirSetor(){
    if(!confirm(`Excluir o setor ${this.st.nome}?`))return;
    try{await this.api('DELETE','setores/'+this.st.id);if(this.setorSel===this.st.id)this.setorSel=null;this.st=null;await this.carregar()}
    catch(e){this.erroSt=e.message}
  },

  // backup
  async abrirBackup(){this.erroBk='';this.bk=await this.api('GET','backup');this.bkDir=this.bk.dir},
  async salvarBackup(){try{this.bk=await this.api('PUT','backup',{dir:this.bkDir});this.bkDir=this.bk.dir;this.aviso('Pasta salva')}catch(e){this.erroBk=e.message}},
  async backupAgora(){this.erroBk='';try{this.bk=await this.api('POST','backup/agora');this.aviso('Backup feito')}catch(e){this.erroBk=e.message}}
}}
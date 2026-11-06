// The existing SiteContentState class belongs to this private QA Core Worker.
// No script_name or namespace ID may select another Worker's state.
export const QA_SITE_CONTENT_BINDING={name:'SITE_CONTENT_STATE',class_name:'SiteContentState'};
export const QA_SITE_CONTENT_MIGRATION={tag:'v1-private-qa-site-content-state',new_sqlite_classes:['SiteContentState']};
export function withQaSiteContentState(config){
 if(config.name!=='sstrx-functional-v3-qa-core'||config.account_id!=='9e5386dcf455be34c582d93f8bfc79e6'||config.workers_dev!==false||config.preview_urls!==false||!Array.isArray(config.routes)||config.routes.length||config.vars?.SSTRX_ENVIRONMENT!=='synthetic'||config.vars?.SSTRX_QA_STACK!=='joined-v31'||config.vars?.SSTRX_QA_DATABASE_ID!=='3a891880-ea14-4a57-a02e-7f6f3de7f785')throw Error('isolated_qa_core_configuration_required');
 if(config.exports)throw Error('existing_do_exports_require_review');
 const out=structuredClone(config),bindings=out.durable_objects?.bindings||[];
 if(!Array.isArray(bindings)||bindings.some(x=>x.name!=='SITE_CONTENT_STATE'||Object.keys(x).sort().join(',')!=='class_name,name'||x.class_name!=='SiteContentState')||bindings.length>1)throw Error('worker_owned_qa_site_content_binding_required');
 const migrations=out.migrations||[];
 if(!Array.isArray(migrations)||migrations.some(x=>x.tag!==QA_SITE_CONTENT_MIGRATION.tag||JSON.stringify(x)!==JSON.stringify(QA_SITE_CONTENT_MIGRATION))||migrations.length>1)throw Error('existing_do_migrations_require_review');
 out.durable_objects={...(out.durable_objects||{}),bindings:[{...QA_SITE_CONTENT_BINDING}]};
 out.migrations=[structuredClone(QA_SITE_CONTENT_MIGRATION)];
 return out;
}

export function failClosedQaSiteContentState(config){
 const prepared=withQaSiteContentState(config);
 if(JSON.stringify(prepared)!==JSON.stringify(config))throw Error('Prepared post-migration QA configuration required');
 const fallback=structuredClone(config);fallback.durable_objects.bindings=[];
 return fallback;
}

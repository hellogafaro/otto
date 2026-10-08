import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { createConnection, getConnection, getCredential, userScope, workspaceScope } from '@otto/shared/connections'
import { fetchOpenAiModels } from '../../model-fetchers/openai'
import { initModelRefreshService, setFetcherPlatform } from '../../model-fetchers'
import { addWorkspace, saveConfig } from '@otto/shared/config/storage'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerLlmConnectionsHandlers } from './llm-connections'

const keys: string[] = []
const logs: string[] = []
let catalogFailure = false
const endpoint = Bun.serve({ port:0, hostname:'127.0.0.1', async fetch(request) {
  keys.push(request.headers.get('authorization') ?? '')
  if (catalogFailure) return new Response('fixture-body-private', { status: 401 })
  if (request.url.endsWith('/models')) return Response.json({data:[{id:'gpt-scoped'}]})
  await request.json()
  const parts = [{type:'response.created',response:{id:'fixture',created_at:0,model:'gpt-scoped'}},{type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg'}},{type:'response.output_text.delta',item_id:'msg',delta:'OK'},{type:'response.completed',response:{usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}]
  return new Response(parts.map((part)=>`data: ${JSON.stringify(part)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})
} })
afterAll(()=>endpoint.stop())
const handlers = new Map<string, HandlerFn>()
const logger = { info:(...args:unknown[])=>logs.push(args.join(' ')),warn:(...args:unknown[])=>logs.push(args.join(' ')),error:(...args:unknown[])=>logs.push(args.join(' ')),debug:(...args:unknown[])=>logs.push(args.join(' ')) }
registerLlmConnectionsHandlers({handle:(channel,handler)=>{handlers.set(channel,handler)},push(){},async invokeClient(){}} as RpcServer,{sessionManager:{refreshConnectionRuntime:async()=>{}},platform:{logger}} as unknown as HandlerDeps)
const call = (channel:string,ctx:RequestContext,...args:unknown[])=>handlers.get(channel)!(ctx,...args)

it('keeps exact user/workspace keys separate and exposes unsupported records without converting them',async()=>{
  saveConfig({workspaces:[]})
  const workspace=addWorkspace({name:'Connections fixture',rootPath:join(CONFIG_DIR,'connections')})
  const ctx=(userId:string):RequestContext=>({clientId:userId,userId,workspaceId:workspace.id,webContentsId:null})
  for(const [user,key] of [['anaaaaaaaaaa','fixture-ana'],['benbbbbbbbbb','fixture-ben']]) createConnection({scope:userScope(user),slug:'same-name',title:user,type:'openai',authType:'api_key',baseUrl:endpoint.url.href+'v1',defaultModel:'pi/gpt-scoped',models:['pi/gpt-scoped']},{apiKey:key})
  createConnection({scope:workspaceScope(workspace.id),slug:'shared',title:'Shared',type:'openai',authType:'api_key',baseUrl:endpoint.url.href+'v1',defaultModel:'gpt-scoped'},{apiKey:'fixture-shared'})
  createConnection({scope:userScope('benbbbbbbbbb'),slug:'ben-private',title:'Private',type:'openai',authType:'api_key'},{apiKey:'fixture-private'})
  createConnection({scope:userScope('anaaaaaaaaaa'),slug:'subscription',title:'Old login',type:'openai-codex',authType:'oauth'},{accessToken:'fixture-oauth',refreshToken:'fixture-refresh'})
  expect(await call(RPC_CHANNELS.llmConnections.TEST,ctx('anaaaaaaaaaa'),'same-name')).toEqual({success:true})
  expect(await call(RPC_CHANNELS.llmConnections.TEST,ctx('benbbbbbbbbb'),'same-name')).toEqual({success:true})
  expect(await call(RPC_CHANNELS.llmConnections.TEST,ctx('anaaaaaaaaaa'),'shared')).toEqual({success:true})
  expect(keys).toEqual(['Bearer fixture-ana','Bearer fixture-ben','Bearer fixture-shared'])
  expect(await call(RPC_CHANNELS.llmConnections.GET,ctx('anaaaaaaaaaa'),'ben-private')).toBeNull()
  const before=keys.length
  const list=await call(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,ctx('anaaaaaaaaaa')) as any[]
  expect(list.find((row)=>row.slug==='subscription')).toMatchObject({runtimeSupported:false})
  expect(list.find((row)=>row.slug==='subscription').authError).toContain('unavailable')
  expect((await call(RPC_CHANNELS.llmConnections.TEST,ctx('anaaaaaaaaaa'),'subscription') as any).success).toBe(false)
  expect(keys).toHaveLength(before)
  expect(getCredential('subscription',userScope('anaaaaaaaaaa'))).toMatchObject({accessToken:'fixture-oauth',refreshToken:'fixture-refresh'})
  createConnection({scope:'install',slug:'install-collision',title:'Install private',type:'openai',authType:'api_key'},{apiKey:'fixture-install-private'})
  const beforeCollision = keys.length
  for (const scope of ['user','workspace']) {
    const result = await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,ctx('anaaaaaaaaaa'),{slug:'install-collision',scope,type:'openai',title:'New scoped',baseUrl:endpoint.url.href+'v1'}) as any
    expect(result.success).toBe(false)
  }
  expect(keys).toHaveLength(beforeCollision)
  expect(getCredential('install-collision','install')).toMatchObject({apiKey:'fixture-install-private'})
  const beforeNative = keys.length
  const catalog = await fetchOpenAiModels({apiKey:'fixture-ben',baseUrl:endpoint.url.href+'v1'})
  expect(catalog.models.some((model)=>model.id.startsWith('pi/'))).toBe(false)
  expect(catalog.models.map((model)=>model.id)).toEqual(['gpt-scoped'])
  expect(keys.slice(beforeNative)).toEqual(['Bearer fixture-ben'])
  expect(getConnection('same-name',{userId:'benbbbbbbbbb'})!.defaultModel).toBe('pi/gpt-scoped')
  expect(await call(RPC_CHANNELS.llmConnections.REFRESH_MODELS,ctx('anaaaaaaaaaa'),'same-name')).toEqual({success:true})
  expect(getConnection('same-name',{userId:'anaaaaaaaaaa'})!.models?.map((model:any)=>model.id)).toEqual(['gpt-scoped'])
  expect(getConnection('same-name',{userId:'anaaaaaaaaaa'})!.defaultModel).toBe('gpt-scoped')
  expect(getConnection('same-name',{userId:'benbbbbbbbbb'})!.defaultModel).toBe('pi/gpt-scoped')
  const credentialScopes: string[] = []
  setFetcherPlatform({logger} as unknown as HandlerDeps['platform'])
  const service = initModelRefreshService(async (slug,scope)=>{
    credentialScopes.push(scope)
    return {apiKey:getCredential(slug,scope)?.apiKey}
  })
  const beforeService = keys.length
  await service.refreshNow('same-name',userScope('benbbbbbbbbb'))
  expect(keys.slice(beforeService)).toEqual(['Bearer fixture-ben'])
  expect(credentialScopes).toEqual([userScope('benbbbbbbbbb')])
  expect(getConnection('same-name',{userId:'benbbbbbbbbb'})!.models?.map((model)=>typeof model==='string'?model:model.id)).toEqual(['gpt-scoped'])
  expect(getConnection('same-name',{userId:'benbbbbbbbbb'})!.defaultModel).toBe('gpt-scoped')
  expect(getCredential('same-name',userScope('anaaaaaaaaaa'))).toMatchObject({apiKey:'fixture-ana'})
  expect(getCredential('same-name',userScope('benbbbbbbbbb'))).toMatchObject({apiKey:'fixture-ben'})
  const beforeMissingScope = keys.length
  await service.refreshNow('install-collision',userScope('anaaaaaaaaaa'))
  await service.refreshNow('subscription',userScope('anaaaaaaaaaa'))
  expect(keys).toHaveLength(beforeMissingScope)
  const storedCatalog = getConnection('same-name',{userId:'benbbbbbbbbb'})
  catalogFailure = true
  await service.refreshNow('same-name',userScope('benbbbbbbbbb'))
  catalogFailure = false
  expect(getConnection('same-name',{userId:'benbbbbbbbbb'})).toEqual(storedCatalog)
  service.stopAll()
  expect(await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,ctx('anaaaaaaaaaa'),{slug:'fresh',type:'openai',title:'Native new',credential:'fixture-new',baseUrl:endpoint.url.href+'v1'})).toEqual({success:true})
  expect(getConnection('fresh',{userId:'anaaaaaaaaaa'})!.models?.map((model:any)=>model.id)).toEqual(['gpt-scoped'])
  expect(getConnection('fresh',{userId:'anaaaaaaaaaa'})!.defaultModel).toBe('gpt-scoped')
  expect(getCredential('fresh',userScope('anaaaaaaaaaa'))).toMatchObject({apiKey:'fixture-new'})
  expect((await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,ctx('anaaaaaaaaaa'),{slug:'subscription',type:'openai',title:'Do not convert',credential:'fixture-new'}) as any).success).toBe(false)
  expect(getCredential('subscription',userScope('anaaaaaaaaaa'))).toMatchObject({accessToken:'fixture-oauth',refreshToken:'fixture-refresh'})
  expect(JSON.stringify(logs)).not.toMatch(/fixture-ana|fixture-ben|fixture-shared|fixture-oauth|fixture-refresh|fixture-install-private|fixture-body-private|fixture-new/)
})

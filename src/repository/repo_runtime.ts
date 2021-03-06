/**
 * @author Robin Sun
 * @email robin@naturewake.com
 * @create date 2019-09-20 11:59:05
 * @modify date 2019-09-20 11:59:05
 * @desc [description]
 */

import { RepositoryDeployment } from './repo_deploy'
import { Sardines } from 'sardines-core'
import { Service } from './repo_data_structure'
import { utils } from 'sardines-core'

export interface  RuntimeQueryObject {
  name?: string
  type?: Sardines.Runtime.ResourceType
  account?: string
  service_id?: string
  status?: Sardines.Runtime.RuntimeStatus
  workload_percentage?: string
}

export class RepositoryRuntime extends RepositoryDeployment {
  constructor() {
    super()
  }
  protected defaultLoadBalancingStrategy = Sardines.Runtime.LoadBalancingStrategy.evenWorkload
  protected workloadThreshold = 85

  protected async findAvailableRuntime(type:Sardines.Runtime.RuntimeTargetType, target: Service|Sardines.Runtime.Resource, strategy: Sardines.Runtime.LoadBalancingStrategy = this.defaultLoadBalancingStrategy) {
    let { runtimeObj, table } = this.getRuntimeQueryObj(type, target)
    runtimeObj.status = Sardines.Runtime.RuntimeStatus.ready
    runtimeObj.workload_percentage = `le:${this.workloadThreshold}`
    const orderby = { workload_percentage: strategy === Sardines.Runtime.LoadBalancingStrategy.workloadFocusing ? -1 : 1}
    let runtimeInst = await this.db!.get(table, runtimeObj, orderby, 1)
    return runtimeInst
  }

  protected getRuntimeQueryObj(type: Sardines.Runtime.RuntimeTargetType, target: Service|Sardines.Runtime.Resource) {
    let runtimeObj: RuntimeQueryObject = {}, table = null
    switch (type) {
      case Sardines.Runtime.RuntimeTargetType.service:
        runtimeObj = {
          service_id: (<Service>target).id,
        }
        table = 'service_runtime'
        break
      case Sardines.Runtime.RuntimeTargetType.host: default: 
        runtimeObj = {
          name: (<Sardines.Runtime.Resource>target).name,
          type: (<Sardines.Runtime.Resource>target).type,
          account: (<Sardines.Runtime.Resource>target).account,
        }
        table = 'resource'
        break
    }
    return { runtimeObj, table }
  }

  async fetchServiceRuntime(serviceIdentity: Sardines.ServiceIdentity|Sardines.ServiceIdentity[], token: string, bypassToken: boolean = false): Promise<Sardines.Runtime.Service|Sardines.Runtime.Service[]|null> {
    console.log('[repository] fetching service runtime:', serviceIdentity, 'token:', token)
    
    if (!serviceIdentity || !token) return null
    if (!bypassToken) await this.validateToken(token, true)
    if (Array.isArray(serviceIdentity)) {
      let res: Sardines.Runtime.Service[] = []
      for (let i=0; i<serviceIdentity.length; i++) {
        let resItem: Sardines.Runtime.Service|null = <Sardines.Runtime.Service|null>await this.fetchServiceRuntime(serviceIdentity[i], token, bypassToken=true)
        if (resItem) res.push(resItem)
      }
      return res
    } else {
      let serviceQuery: any = {}
      if (!serviceIdentity.application || !serviceIdentity.module ||!serviceIdentity.name) {
        throw utils.unifyErrMesg(`Invalid service while querying service runtime`, 'repository', 'fetch service runtime')
      }
      serviceQuery.application = serviceIdentity.application
      serviceQuery.module = serviceIdentity.module
      serviceQuery.name = serviceIdentity.name
      if (serviceIdentity.version && serviceIdentity.version !== '*') serviceQuery.version = serviceIdentity.version

      let service  :Service|null = null
      if (serviceIdentity.application !== 'sardines') service = <Service|null>await this.queryService(serviceQuery, token, bypassToken = true)
      if (serviceIdentity.application === 'sardines' || service) {
        if (service) serviceQuery = { id: service.id }
        let runtime :any = await this.findAvailableRuntime(Sardines.Runtime.RuntimeTargetType.service, serviceQuery)
        if (runtime) {
          let result: Sardines.Runtime.Service = {
            identity: {
              application: serviceIdentity.application,
              module: serviceIdentity.module,
              name: serviceIdentity.name,
              version: runtime.version
            },
            entries: [{
              type: runtime.entry_type,
              providerInfo: runtime.provider_info,
              settingsForProvider: runtime.settings_for_provider
            }],
            expireInSeconds: runtime.expire_in_seconds
          }
          if (service) {
            result.arguments = service.arguments
            result.returnType = service.return_type
          }
          return result
        }
      }
    }
    return null
  }

  async removeServiceRuntime(data: {hosts?: string[], applications?: string[], modules?: string[], services?: string[], versions?: string[], tags?: string[]}, token: string) {
    const tokenObj = await this.validateToken(token, true)
    if (!tokenObj || !tokenObj.account_id) throw 'invalid token'
    if ((this.owner && tokenObj.account_id === this.owner.id) || (this.shoalUser && tokenObj.account_id === this.shoalUser.id)){
      
    } else {
      throw 'unauthorized account'
    }
    let result = 'No service runtime has been removed'
    let hostIdList = []
    let hostlist = data.hosts
    // Query host list according to attributes of service runtimes
    if (!hostlist || !hostlist.length || hostlist.indexOf('*')>=0) {
      const hostQuery:any = {
      }
      if (data.applications && data.applications.length && data.applications.indexOf('*')<0) {
        hostQuery.application = data.applications
      }
      if (data.modules && data.modules.length && data.modules.indexOf('*')<0) {
        hostQuery.module = data.modules
      }
      if (data.services && data.services.length && data.services.indexOf('*')<0) {
        hostQuery.service = data.services
      }
      if (data.versions && data.versions.length && data.versions.indexOf('*')<0) {
        hostQuery.version = data.versions
      }
      if (data.tags && data.tags.length && data.tags.indexOf('*')<0) {
        hostQuery.tags = data.tags
      }
      hostlist = await this.db!.get('service_runtime', hostQuery, null, 0, 0, ['resource_id'])
    }

    if (!Array.isArray(hostlist) && hostlist) {
      hostlist = [hostlist]
    }

    if (hostlist && hostlist.length && Array.isArray(hostlist)) {
      for (let hoststr of hostlist) {
        const pair = hoststr.split('@')
        if (!pair || pair.length > 2) {
          throw `invalid host account and name: ${hoststr}, which should be "user@hostname"`
        }
        let hostId = ''
        if (pair.length === 1) {
          hostId = hoststr
        } else {
          const user = pair[0]
          const host = pair[1]
          const hostInst = await this.db!.get('resource', {
                                                         name: host, 
                                                         account: user, 
                                                         type: Sardines.Runtime.ResourceType.host
                                                       }, null, 1, 0, ['id'])
          if (hostInst) hostId = hostInst.id
        }
        hostIdList.push(hoststr === hostId ? {hostId: hostId} : {
          host: hoststr,
          hostId: hostId
        })
        
        if (hostId) {
          // TODO: communicate with target hosts and shutdown those services on their agents
          const agentData: any = Object.assign({}, data)
          delete agentData.hosts
          try {
            console.log(`[repository][removeServiceRuntime] going to remove service runtimes on host [${hostId}]:`)
            console.log(agentData)
            const agentResponse = await this.invokeHostAgent({id: hostId}, 'removeServices', agentData)
            console.log('[repository][removeServiceRuntime] agent response:', agentResponse)
            if (agentResponse.res && Array.isArray(agentResponse.res) && agentResponse.res.length) {
              const dbres = await this.db!.set('service_runtime', null, {id: agentResponse.res})
              console.log(`[repository][removeServiceRuntime] database response of removing service runtimes:`, dbres)
              result = dbres
            } else if (agentResponse.error) {
              console.log('[repository][removeServiceRuntime] agent returned an error:', agentResponse.error)
              throw agentResponse.error
            } else {
              console.log('[repository][removeServiceRuntime] agent returned an empty response:', agentResponse.res)
              throw 'empty response from agent'
            }
          } catch (e) {
            console.log('[repository][removeServiceRuntime] Error while requesting agent to remove service runtimes', e)
            console.log('[repository][removeServiceRuntime] going to remove records in database')
            const query: any = { resource_id: hostId }
            if (data.applications && data.applications.length && data.applications.indexOf('*') >= 0) {
              let applicationList = await this.db!.get('service_runtime', query, null, 0, 0, ['application'])
              applicationList = applicationList.map((item: any) => {
                if (typeof item === 'object' && typeof item.application === 'string') {
                  return item.application
                } else {
                  return item
                }
              })
              if (applicationList && Array.isArray(applicationList) && applicationList.length) {
                if (applicationList.indexOf('sardines') >= 0) {
                  applicationList.splice(applicationList.indexOf('sardines'),1)
                }
                if (applicationList.length) {
                  query.application = applicationList
                }  
              }
            } else if (data.applications && data.applications.length) {
              if (data.applications.indexOf('sardines') >= 0) {
                data.applications.splice(data.applications.indexOf('sardines'), 1)
              }
              if (data.applications.length) {
                query.application = data.applications
              }
            }

            if (data.modules && data.modules.length && data.modules.indexOf('*') < 0) {
              query.module = data.modules
            }

            if (data.services && data.services.length && data.services.indexOf('*') < 0) {
              query.service = data.services
            }

            if (data.versions && data.versions.length && data.versions.indexOf('*') < 0) {
              query.version = data.versions
            }
            console.log('[reposiotry][removeServiceRuntime] removing database records using query:',query)
            const res = await this.db!.set('service_runtime', null, query)
            console.log('[reposiotry] service runtimes data removed no matter the host agent alive or not:', res)
            result = res
          }
        }
      }
    }

    return {
      result,
      input: data,
      hosts: hostIdList
    }
  }

  async updateHostIPAddress(data: {host: string, ipv4?: string, ipv6?: string}, token: string) {
    const tokenObj = await this.validateToken(token, true)
    if (!tokenObj || !tokenObj.account_id) throw 'invalid token'
    if ((this.owner && tokenObj.account_id === this.owner.id) || (this.shoalUser && tokenObj.account_id === this.shoalUser.id)){
      
    } else {
      throw 'unauthorized account'
    }

    if (!data || !data.host || typeof data.host !== 'string' || data.host.indexOf(',')>=0) throw 'invalid host data'
    if (!data.ipv4 && !data.ipv6) throw 'invalid address data'

    // get host instance in database
    let hostObj:any = null
    if (data.host.indexOf('@') > 0) {
      const pair = data.host.split('@')
      if (!pair || !pair.length || pair.length !== 2) throw 'invalid host data'
      hostObj = await this.db!.get('resource', {account: pair[0], name: pair[1]})
    } else {
      hostObj = await this.db!.get('resource', {id: data.host})
    }
    if (!hostObj) throw 'can not find target host'

    // prepare host address data to be updated, and remember the previous values
    if (typeof hostObj.address === 'string'
    && hostObj.address[0]=== '(' && hostObj.address[hostObj.address.length-1] === ')') {
      hostObj.address = hostObj.address.substr(1, hostObj.address.length-2)
      const pair = hostObj.address.split(',')
      hostObj.address = {
        ipv4: pair[0],
        ssh_port: pair[1],
        ipv6: pair[2]
      }
    } else {
      hostObj.address = {}
    }
    let previousAddr = Object.assign({}, hostObj.address)
    if (data.ipv4) {
      hostObj.address.ipv4 = data.ipv4
    }
    if (data.ipv6) {
      hostObj.address.ipv6 = data.ipv6
    }

    // go through providers of the host
    const updateProvider = (pvdr: any) => {
      let updated = false
      if (!pvdr) return updated
      let providerInfo: any = null
      if (pvdr.providerSettings && pvdr.providerSettings.public) {
        providerInfo = pvdr.providerSettings.public
      } else if (pvdr.host) {
        providerInfo = pvdr
      }
      if (!providerInfo) return updated

      if (providerInfo.host === previousAddr.ipv4) {
        updated = true
        providerInfo.host = data.ipv4
      } else if (providerInfo.host === previousAddr.ipv6) {
        updated = true
        providerInfo.host = data.ipv6
      }
      return updated
    }
    let providers = []
    if (hostObj.providers && Array.isArray(hostObj.providers) && hostObj.providers.length) providers = hostObj.providers
    else if (hostObj.providers) providers.push(hostObj.providers)
    for(let i=0; i<providers.length; i++) {
      let pvdr = providers[i]
      updateProvider(pvdr)
    }

    // update host address in database
    await this.db!.set('resource', hostObj, {id: hostObj.id})

    // go through providers of service runtimes
    let serviceRuntimeList = await this.db!.get('service_runtime', {resource_id: hostObj.id}, null, 0)
    if (!serviceRuntimeList) return {hosts: 1, serviceRuntimes: 0}
    if (!Array.isArray(serviceRuntimeList)) serviceRuntimeList = [serviceRuntimeList]

    let updatedRTCnt = 0
    for (let i = 0; i<serviceRuntimeList.length; i++) {
      let rt = serviceRuntimeList[i]
      let updatedRaw = updateProvider(rt.provider_raw)
      let updatedInfo = updateProvider(rt.provider_info)
      if (updatedInfo || updatedRaw) {
        await this.db!.set('service_runtime', rt, {id: rt.id})
        updatedRTCnt++
      }
    }
    return {hosts: 1, serviceRuntimes: updatedRTCnt}
  }
}
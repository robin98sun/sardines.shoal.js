/**
 * @author Robin Sun
 * @email robin@naturewake.com
 * @create date 2019-06-13 15:42:55
 * @modify date 2019-06-13 15:42:55
 * @desc [description]
 */

import { utils, Sardines } from 'sardines-core'
import * as path from 'path'
import * as proc from 'process'
import * as fs from 'fs'
import { RepositoryClient } from 'sardines-core'
import * as deployer from './deployer'
import { agentState } from './agent'

// setup repository client
const sardinesConfigFilepath = path.resolve(proc.cwd(), './sardines-config.json')
if (fs.existsSync(sardinesConfigFilepath)) {
    console.log('loading sardines config:', sardinesConfigFilepath)
    const sardinesConfig = require(sardinesConfigFilepath)
    if (!sardinesConfig.sardinesDir) {
        throw `invalid sardines config file, sardinesDir property is missing`
    }
    require(`./${sardinesConfig.sardinesDir}`)
    RepositoryClient.setupRepositoryEntriesBySardinesConfig(sardinesConfig, true)
}

export interface DeployJobResult {
    deployPlanFile: string
    res: Sardines.Runtime.DeployResult
}

const {files} = utils.parseArgs()
if (files && files.length >= 2 && files.length % 2 === 0) {
    const jobs = async() => {
        const serviceRuntimeQueue: DeployJobResult[] = []
        for (let i = 0; i<files.length; i+=2) {
            const serviceDefinitionFile = files[i]
            const serviceDeployPlanFile = files[i+1]
            try {
                const {deployResult} = await deployer.deployServicesByFiles(serviceDefinitionFile, serviceDeployPlanFile, agentState, false)
                if (!deployResult) {
                    throw `can not deploy service in file [${serviceDeployPlanFile}]`
                } else {
                    serviceRuntimeQueue.push({deployPlanFile: serviceDeployPlanFile, res: deployResult})
                }
                console.log(`services in ${serviceDefinitionFile} have been started`)
            } catch (e) {
                console.error(`ERROR when deploying services in ${serviceDefinitionFile}:`, e)
            }
        }
        
        // send deploy result
        for (let deployResult of serviceRuntimeQueue) {
            await deployer.sendDeployResultToRepository(deployResult.res, agentState)
        }
    }
    
    jobs().then(()=>{}).catch(e=> {
        console.error('Error while deploying services:', e)
    })
}

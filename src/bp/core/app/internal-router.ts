import { Logger } from 'botpress/sdk'
import { UnauthorizedError } from 'common/http'
import { MemoryObjectCache } from 'core/bpfs'
import { CMSService } from 'core/cms'
import { ModuleLoader } from 'core/modules'
import { RealtimeService, RealTimePayload } from 'core/realtime'
import { CustomRouter } from 'core/routers/customRouter'
import { Router } from 'express'
import { AppLifecycle, AppLifecycleEvents } from 'lifecycle'
import _ from 'lodash'

export class InternalRouter extends CustomRouter {
  constructor(
    private cmsService: CMSService,
    private logger: Logger,
    private moduleLoader: ModuleLoader,
    private realtime: RealtimeService,
    private objectCache: MemoryObjectCache
  ) {
    super('Internal', logger, Router({ mergeParams: true }))
  }

  setupRoutes() {
    if (!process.INTERNAL_PASSWORD) {
      return
    }

    const router = this.router
    router.use((req, res, next) => {
      if (req.headers.authorization !== process.INTERNAL_PASSWORD) {
        return next(new UnauthorizedError('Invalid password'))
      }

      next()
    })

    router.post(
      '/onModuleEvent',
      this.asyncMiddleware(async (req, res) => {
        const { eventType, botId } = req.body

        switch (eventType) {
          case 'onFlowChanged':
            const { flow } = req.body
            await this.moduleLoader.onFlowChanged(botId, flow)
            break
          case 'onFlowRenamed':
            const { previousFlowName, nextFlowName } = req.body
            await this.moduleLoader.onFlowRenamed(botId, previousFlowName, nextFlowName)
            break
          case 'onElementChanged':
            const { action, element, oldElement } = req.body
            await this.moduleLoader.onElementChanged(botId, action, element, oldElement)
            break
          case 'onTopicChanged':
            const { oldName, newName } = req.body
            await this.moduleLoader.onTopicChanged(botId, oldName, newName)
            break
        }

        res.sendStatus(200)
      })
    )

    router.post(
      '/invalidateCmsForBot',
      this.asyncMiddleware(async (req, res) => {
        const { botId } = req.body

        // Invalidations are sent via redis when cluster is on
        if (!process.CLUSTER_ENABLED) {
          await this.cmsService.broadcastInvalidateForBot(botId)
        }

        res.sendStatus(200)
      })
    )

    router.post(
      '/notifyFlowChange',
      this.asyncMiddleware(async (req, res) => {
        const payload = RealTimePayload.forAdmins('flow.changes', req.body)
        this.realtime.sendToSocket(payload)

        res.sendStatus(200)
      })
    )

    router.post(
      '/invalidateFile',
      this.asyncMiddleware(async (req, res) => {
        const { key } = req.body
        await this.objectCache.invalidate(key, true)

        res.sendStatus(200)
      })
    )

    router.post(
      '/setStudioReady',
      this.asyncMiddleware(async (req, res) => {
        AppLifecycle.setDone(AppLifecycleEvents.STUDIO_READY)
        res.sendStatus(200)
      })
    )
  }
}

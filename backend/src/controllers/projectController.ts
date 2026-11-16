import type { Request, Response } from 'express';
import type { ProjectService } from '../services/ProjectService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { newProjectSchema, tagSchema, updateProjectSchema } from '../validators/projectValidators.js';
import { reportRangeSchema } from '../validators/reportValidators.js';
import { idParamsSchema, parseInput } from '../validators/validate.js';

export function createProjectController(service: ProjectService) {
  return {
    async list(_req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.list());
    },
    async create(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await service.create(parseInput(newProjectSchema, req.body), req.user!.id), { statusCode: 201, message: 'Project added' });
    },
    async update(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      sendSuccess(res, await service.update(id, parseInput(updateProjectSchema, req.body), req.user!.id));
    },
    async remove(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      await service.remove(id, req.user!.id);
      sendSuccess(res, null, { message: 'Project removed' });
    },
    async tag(req: Request, res: Response): Promise<void> {
      const { kind, id, projectId } = parseInput(tagSchema, req.body);
      await service.tag(kind, id, projectId, req.user!.id);
      sendSuccess(res, null, { message: projectId === null ? 'Taken off the project' : 'Put on the project' });
    },
    async profit(req: Request, res: Response): Promise<void> {
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await service.profit({ startDate, endDate }));
    },
    async documents(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(idParamsSchema, req.params);
      const { startDate, endDate } = parseInput(reportRangeSchema, req.query);
      sendSuccess(res, await service.documents(id, { startDate, endDate }));
    },
  };
}

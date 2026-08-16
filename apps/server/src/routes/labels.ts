import { LabelPdfInput } from '@totetrack/shared';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import type { Env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { asyncHandler, parseBody } from '../lib/http.js';
import { listBoxesByIds, markBoxesPrinted } from '../services/boxes.js';
import {
  DEFAULT_LABEL_TEMPLATE,
  getTemplate,
  listTemplates,
  renderCalibrationPdf,
  renderLabelsPdf,
} from '../services/labels.js';
import { effectivePublicUrl, getSetting, SETTING_KEYS } from '../services/settings.js';

export function labelsRouter(db: Db, env: Env): Router {
  const r = Router();

  r.get('/templates', (_req, res) => {
    res.json({ templates: listTemplates(), defaultTemplateId: DEFAULT_LABEL_TEMPLATE });
  });

  r.get(
    '/calibration',
    asyncHandler(async (req, res) => {
      const templateId =
        typeof req.query.templateId === 'string' ? req.query.templateId : undefined;
      const pdf = await renderCalibrationPdf(templateId);
      res.type('application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="totetrack-calibration-${getTemplate(templateId).id}.pdf"`,
      );
      res.send(Buffer.from(pdf));
    }),
  );

  r.post(
    '/pdf',
    asyncHandler(async (req, res) => {
      const input = parseBody(LabelPdfInput, req.body);
      const templateId =
        input.templateId ??
        (await getSetting(db, SETTING_KEYS.defaultLabelTemplate)) ??
        DEFAULT_LABEL_TEMPLATE;
      const rows = await listBoxesByIds(db, input.boxIds);
      if (!rows.length) throw badRequest('No matching boxes');
      // Preserve requested order.
      const byId = new Map(rows.map((b) => [b.id, b]));
      const ordered = input.boxIds
        .map((id) => byId.get(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      const pdf = await renderLabelsPdf(ordered, {
        templateId,
        startOffset: input.startOffset,
        includeName: input.includeName,
        publicUrl: await effectivePublicUrl(db, env),
      });
      if (input.markPrinted)
        await markBoxesPrinted(
          db,
          ordered.map((b) => b.id),
        );
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="totetrack-labels.pdf"`);
      res.send(Buffer.from(pdf));
    }),
  );

  return r;
}

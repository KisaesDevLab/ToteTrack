import { LabelPdfInput, normalizeLabelId, PreprintInput } from '@totetrack/shared';
import { Router } from 'express';
import type { Db } from '../db/index.js';
import type { Env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { asyncHandler, idParam, parseBody } from '../lib/http.js';
import { listBoxesByIds, markBoxesPrinted } from '../services/boxes.js';
import {
  DEFAULT_LABEL_TEMPLATE,
  getTemplate,
  listTemplates,
  renderCalibrationPdf,
  renderLabelsPdf,
} from '../services/labels.js';
import {
  deletePreprinted,
  listPreprinted,
  lookupLabel,
  reservePreprinted,
} from '../services/preprint.js';
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
        publicUrl: (await effectivePublicUrl(db, env, req)).url,
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

  // --- pre-printed labels ---------------------------------------------------

  // Reserve the next N numbers of a series and print blank labels for them (no box name line).
  r.post(
    '/preprint',
    asyncHandler(async (req, res) => {
      const input = parseBody(PreprintInput, req.body);
      const templateId =
        input.templateId ??
        (await getSetting(db, SETTING_KEYS.defaultLabelTemplate)) ??
        DEFAULT_LABEL_TEMPLATE;
      const labels = await reservePreprinted(db, input.seriesId, input.count);
      const pdf = await renderLabelsPdf(
        labels.map((l) => ({ labelId: l.labelId, name: null })),
        {
          templateId,
          startOffset: input.startOffset,
          includeName: false,
          publicUrl: (await effectivePublicUrl(db, env, req)).url,
        },
      );
      res.type('application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="totetrack-preprint-${labels[0]?.labelId}-${labels.at(-1)?.labelId}.pdf"`,
      );
      res.send(Buffer.from(pdf));
    }),
  );

  r.get(
    '/preprinted',
    asyncHandler(async (req, res) => {
      const seriesId = req.query.seriesId
        ? idParam(String(req.query.seriesId), 'seriesId')
        : undefined;
      res.json(
        await listPreprinted(db, { seriesId, unclaimedOnly: req.query.unclaimed === 'true' }),
      );
    }),
  );

  r.delete(
    '/preprinted/:id',
    asyncHandler(async (req, res) => {
      await deletePreprinted(db, idParam(req.params.id));
      res.status(204).end();
    }),
  );

  // Resolves a scanned label to a box / a pre-printed label / nothing.
  r.get(
    '/lookup/:labelId',
    asyncHandler(async (req, res) => {
      const normalized = normalizeLabelId(String(req.params.labelId ?? ''));
      if (!normalized) throw badRequest('Invalid label');
      res.json(await lookupLabel(db, normalized));
    }),
  );

  return r;
}

import * as React from 'react';
import { Sparkles, Play, Layers, Trash2, Download, Upload } from 'lucide-react';
import { useStore } from '../store';
import { Badge, Button, Card, Input, Label } from '../components/primitives';
import { Dialog, DialogContent } from '../components/overlays';
import { EmptyState } from '../components/EmptyState';
import { toast } from '../components/Toaster';
import { skillsRepo } from '../../storage/repos';
import type { Skill } from '../../engine/contracts/skill';

export function SkillsPage({
  onRunBatch,
}: {
  onRunBatch: (skill: Skill) => void;
}) {
  const t = useStore((s) => s.t);
  const skills = useStore((s) => s.skills);
  const reloadSkills = useStore((s) => s.reloadSkills);
  const runSkillOnce = useStore((s) => s.runSkillOnce);
  const isRunning = useStore((s) => s.isRunning);
  const [runSkill, setRunSkill] = React.useState<Skill | null>(null);
  const [slotData, setSlotData] = React.useState<Record<string, string>>({});
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void reloadSkills();
  }, [reloadSkills]);

  const openRun = (skill: Skill) => {
    setRunSkill(skill);
    setSlotData(
      Object.fromEntries(skill.slots.map((s) => [s.name, s.example ?? ''])),
    );
  };

  const doRunOnce = async () => {
    if (!runSkill) return;
    setRunSkill(null);
    try {
      await runSkillOnce(runSkill, slotData);
      toast.success(t('common.succeeded'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doDelete = async (skill: Skill) => {
    await skillsRepo.remove(skill.id);
    await reloadSkills();
    toast.success(t('skills.deleted'));
  };

  const doExport = (skill: Skill) => {
    const blob = new Blob([JSON.stringify(skill, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skill.name}.skill.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('skills.exported'));
  };

  const doImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : [data];
      await skillsRepo.import(list);
      await reloadSkills();
      toast.success(t('skills.imported'));
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (skills.length === 0) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex justify-end p-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => fileRef.current?.click()}
          >
            <Upload className='h-3.5 w-3.5' />
            {t('common.import')}
          </Button>
          <input
            ref={fileRef}
            type='file'
            accept='.json'
            hidden
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
          />
        </div>
        <EmptyState
          className='flex-1'
          icon={<Sparkles className='h-6 w-6' />}
          title={t('skills.emptyTitle')}
          desc={t('skills.emptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex justify-end p-2'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => fileRef.current?.click()}
        >
          <Upload className='h-3.5 w-3.5' />
          {t('common.import')}
        </Button>
        <input
          ref={fileRef}
          type='file'
          accept='.json'
          hidden
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
      </div>
      <div className='min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-3'>
        {skills.map((skill) => (
          <Card key={skill.id} className='p-3.5'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold text-fg'>
                  {skill.name}
                </div>
                <div className='mt-0.5 line-clamp-1 text-[12px] text-muted-fg'>
                  {skill.description}
                </div>
              </div>
              <div className='flex shrink-0 gap-1'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => doExport(skill)}
                  title={t('common.export')}
                >
                  <Download className='h-3.5 w-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => doDelete(skill)}
                  title={t('common.delete')}
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
            <div className='mt-2 flex flex-wrap gap-1'>
              {skill.slots.map((s) => (
                <Badge key={s.name} tone='primary'>
                  {s.label}
                </Badge>
              ))}
            </div>
            <div className='mt-2 flex items-center justify-between'>
              <div className='text-[11px] text-muted-fg'>
                {t('skills.slotCount', { n: skill.slots.length })} ·{' '}
                {t('skills.stepCount', { n: skill.steps.length })} ·{' '}
                {skill.lastRunAt
                  ? `${t('skills.lastRun')} ${new Date(skill.lastRunAt).toLocaleDateString()}`
                  : t('skills.neverRun')}
              </div>
              <div className='flex gap-1.5'>
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => openRun(skill)}
                  disabled={isRunning}
                >
                  <Play className='h-3.5 w-3.5' />
                  {t('skills.runOnce')}
                </Button>
                <Button size='sm' onClick={() => onRunBatch(skill)}>
                  <Layers className='h-3.5 w-3.5' />
                  {t('skills.runBatch')}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!runSkill} onOpenChange={(v) => !v && setRunSkill(null)}>
        <DialogContent
          title={runSkill ? `${t('skills.runOnce')} · ${runSkill.name}` : ''}
        >
          <div className='space-y-2.5'>
            {runSkill?.slots.map((slot) => (
              <div key={slot.name} className='space-y-1'>
                <Label>
                  {slot.label}{' '}
                  {slot.required && <span className='text-destructive'>*</span>}
                </Label>
                <Input
                  value={slotData[slot.name] ?? ''}
                  onChange={(e) =>
                    setSlotData((d) => ({ ...d, [slot.name]: e.target.value }))
                  }
                  placeholder={slot.example}
                />
              </div>
            ))}
          </div>
          <div className='mt-4 flex justify-end gap-2'>
            <Button variant='ghost' size='sm' onClick={() => setRunSkill(null)}>
              {t('common.cancel')}
            </Button>
            <Button size='sm' onClick={doRunOnce}>
              <Play className='h-3.5 w-3.5' />
              {t('common.run')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import type { MatchSettings, ObstacleTypeKey } from '../game/types';
import type { ReactNode } from 'react';
import { MAP_MIN_W, MAP_MAX_W, MAP_MIN_H, MAP_MAX_H } from '../game/types';
import NumField from './NumField';

export const OBSTACLE_LABELS: Record<ObstacleTypeKey, string> = {
  circles: 'Круги',
  squares: 'Квадраты',
  polylines: 'Ломанные линии',
  beziers: 'Кривые Безье',
  closedBeziers: 'Формы Безье',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="cy-label">{label}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick, text }: { on: boolean; onClick: () => void; text?: string }) {
  return (
    <button className="cy-check" data-on={on} onClick={onClick}>
      {text ?? (on ? 'ВКЛ' : 'ВЫКЛ')}
    </button>
  );
}

interface Props {
  ms: MatchSettings;
  onChange: (ms: MatchSettings) => void;
}

/** The full match-settings column — shared by hot-seat setup and the network host lobby. */
export default function MatchSettingsEditor({ ms, onChange }: Props) {
  const set = <K extends keyof MatchSettings>(k: K, v: MatchSettings[K]) => onChange({ ...ms, [k]: v });

  return (
    <div className="flex flex-col gap-1">
      <div className="cy-label mb-2" style={{ color: 'var(--cy-accent)' }}>— Карта и ход</div>

      <Row label={`Размер карты, ед.: ${ms.mapW}×${ms.mapH}`}>
        <NumField value={ms.mapW} min={MAP_MIN_W} max={MAP_MAX_W} step={5} onChange={(n) => set('mapW', n)} width="w-16" />
        <span className="cy-mono text-xs" style={{ color: 'var(--cy-dim)' }}>×</span>
        <NumField value={ms.mapH} min={MAP_MIN_H} max={MAP_MAX_H} step={5} onChange={(n) => set('mapH', n)} width="w-16" />
      </Row>

      <Row label="Таймер хода, сек (0 — без лимита)">
        <NumField value={ms.turnTimerSec} min={0} max={180} step={5} onChange={(n) => set('turnTimerSec', n)} />
      </Row>

      <Row label={`Разброс спавна игроков: ${ms.spawnSpread}%`}>
        <input
          type="range" min={10} max={90} step={5}
          className="cy-range w-40"
          value={ms.spawnSpread}
          onChange={(e) => set('spawnSpread', Number(e.target.value))}
        />
      </Row>

      <Row label="Попаданий до смерти">
        <NumField value={ms.hitsToDie} min={1} max={5} onChange={(n) => set('hitsToDie', n)} width="w-16" />
      </Row>

      <Row label="Точек у игрока">
        <NumField value={ms.pointsPerPlayer} min={1} max={3} onChange={(n) => set('pointsPerPlayer', n)} width="w-16" />
      </Row>
      {ms.pointsPerPlayer > 1 && (
        <div className="cy-mono text-[0.625rem] mt-1" style={{ color: 'var(--cy-dim)' }}>
          режим «GraphWar»: у каждого игрока {ms.pointsPerPlayer} случайно расставленных точки (2 игрока × 3 точки = поле как 3 на 3); каждый ход стрельба идёт от другой случайной точки · жизни у каждой точки: подбитая точка исчезает — игрок стреляет с оставшихся; умирает, когда подбиты все
        </div>
      )}

      <div className="py-1.5">
        <div className="cy-label mb-1.5">Режим матча</div>
        <div className="flex flex-wrap gap-1">
          {([
            { v: 0 as const, text: 'Каждый сам за себя' },
            { v: 2 as const, text: '2 на 2' },
            { v: 3 as const, text: '3 на 3' },
          ]).map((o) => (
            <button
              key={o.v}
              className="cy-seg"
              data-active={ms.teams === o.v}
              onClick={() => onChange({ ...ms, teams: o.v })}
            >
              {o.text}
            </button>
          ))}
        </div>
        {ms.teams > 0 && (
          <div className="cy-mono text-[0.625rem] mt-1" style={{ color: 'var(--cy-dim)' }}>
            ровно {ms.teams * 2} игрока · игроки {ms.teams === 2 ? '1 и 3' : '1, 3 и 5'} — команда 1, остальные — команда 2 · огонь по своим отключён
          </div>
        )}
      </div>

      <Row label="Предпросмотр траектории">
        <Toggle on={ms.previewEnabled} onClick={() => set('previewEnabled', !ms.previewEnabled)} />
      </Row>

      <Row label="Предсказание точки финиша выстрела">
        <Toggle on={ms.predictFinish} onClick={() => set('predictFinish', !ms.predictFinish)} />
      </Row>

      <div className="cy-label mt-4 mb-2" style={{ color: 'var(--cy-accent)' }}>— Ограничения кривых</div>

      <Row label="Лимит колебаний на ед. длины (0 — ∞)">
        <NumField value={ms.oscillationLimit} min={0} max={20} step={0.1} onChange={(n) => set('oscillationLimit', n)} />
      </Row>

      <Row label="Зацикленные маршруты (ВКЛ — петли разрешены)">
        <Toggle on={ms.allowClosedLoops} onClick={() => set('allowClosedLoops', !ms.allowClosedLoops)} />
      </Row>

      <Row label="Проверка достижимости спавнов (гарантия прохода)">
        <Toggle on={ms.ensureReachable} onClick={() => set('ensureReachable', !ms.ensureReachable)} />
      </Row>

      <div className="cy-label mt-4 mb-2" style={{ color: 'var(--cy-accent)' }}>— Логика стрельбы</div>

      <div className="py-1.5">
        <div className="cy-label mb-1.5">Точка отсчёта кривой</div>
        <div className="flex flex-wrap gap-1">
          {([
            { v: 'zero' as const, text: 'Zero point' },
            { v: 'gw' as const, text: 'GW point' },
          ]).map((o) => (
            <button
              key={o.v}
              className="cy-seg"
              data-active={ms.shotMode === o.v}
              onClick={() => onChange({ ...ms, shotMode: o.v })}
            >
              {o.text}
            </button>
          ))}
        </div>
        <div className="cy-mono text-[0.625rem] mt-1" style={{ color: 'var(--cy-dim)' }}>
          {ms.shotMode === 'zero'
            ? 'нулевая точка в танке: x отсчитывается от тебя — вершина параболы в тебе, сдвиг по x: f(x−a)'
            : 'старый вариант: x — абсолютная координата карты, кривая проходит через игрока вертикальным смещением (y не 0)'}
        </div>
      </div>

      <div className="cy-label mt-4 mb-2" style={{ color: 'var(--cy-accent)' }}>— Попадания</div>

      <Row label="Игроков поражает пуля">
        <NumField value={ms.pierce} min={1} max={6} onChange={(n) => set('pierce', n)} width="w-16" />
      </Row>
      <div className="cy-mono text-[0.625rem] mt-0.5" style={{ color: 'var(--cy-dim)' }}>
        {ms.pierce <= 1
          ? 'классика: пуля взрывается при первом попадании в игрока'
          : ms.pierce >= 6
            ? 'пуля проходит сквозь ВСЕХ игроков на пути, взрыв только о препятствие или стену'
            : `до ${ms.pierce} игроков подряд на пути — в любом режиме взрыв о препятствие или стену`}
      </div>

      <Row label="Отброс при попадании">
        <Toggle on={ms.fleeOnHit} onClick={() => set('fleeOnHit', !ms.fleeOnHit)} />
      </Row>
      {ms.fleeOnHit && (
        <Row label="Радиус побега, клеток">
          <NumField value={ms.fleeRadius} min={1} max={10} onChange={(n) => set('fleeRadius', n)} width="w-16" />
        </Row>
      )}
      <div className="cy-mono text-[0.625rem] mt-0.5" style={{ color: 'var(--cy-dim)' }}>
        {ms.hitsToDie > 1
          ? `выжившая жертва отлетает на 1..${ms.fleeRadius} кл. в случайную сторону (не в препятствия и не к другим)`
          : 'работает только когда «Попаданий до смерти» больше 1'}
      </div>

      <div className="cy-label mt-4 mb-2" style={{ color: 'var(--cy-accent)' }}>— Чат и история</div>

      <Row label="Чат в матче (сетевой режим)">
        <Toggle on={ms.chatEnabled} onClick={() => set('chatEnabled', !ms.chatEnabled)} />
      </Row>

      <Row label="Список предыдущих уравнений игрока">
        <Toggle on={ms.eqHistoryMine} onClick={() => set('eqHistoryMine', !ms.eqHistoryMine)} />
      </Row>

      <Row label="Список предыдущих уравнений всех">
        <Toggle on={ms.eqHistoryAll} onClick={() => set('eqHistoryAll', !ms.eqHistoryAll)} />
      </Row>

      <div className="cy-label mt-4 mb-2" style={{ color: 'var(--cy-accent)' }}>— Препятствия</div>

      <Row label="Препятствия на карте">
        <Toggle on={ms.obstaclesEnabled} onClick={() => set('obstaclesEnabled', !ms.obstaclesEnabled)} />
      </Row>

      {ms.obstaclesEnabled && (
        <div className="py-1.5">
          <div className="cy-label mb-1.5">Разрушаемость объектов</div>
          <div className="flex flex-wrap gap-1">
            {([
              { v: 0 as const, text: 'Отключена' },
              { v: 1 as const, text: 'Частичная' },
              { v: 2 as const, text: 'Полная' },
              { v: 3 as const, text: 'Прогрызание' },
            ]).map((o) => (
              <button
                key={o.v}
                className="cy-seg"
                data-active={ms.destruction === o.v}
                onClick={() => onChange({ ...ms, destruction: o.v })}
              >
                {o.text}
              </button>
            ))}
          </div>
          <div className="cy-mono text-[0.625rem] mt-1" style={{ color: 'var(--cy-dim)' }}>
            {ms.destruction === 0
              ? 'препятствия неразрушаемы — пуля останавливается о них'
              : ms.destruction === 1
                ? 'препятствие разрушается с трёх попаданий · повреждённые подсвечиваются'
                : ms.destruction === 2
                  ? 'препятствие разрушается с одного попадания'
                  : 'пуля бурит отверстия · несколько попаданий в одно место = сквозной проём · объект остаётся'}
          </div>
        </div>
      )}

      {ms.obstaclesEnabled && (
        <div className="mt-1">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 items-center pl-2">
            <div className="cy-label">тип</div>
            <div className="cy-label text-center">кол-во</div>
            <div className="cy-label text-center">размер</div>
            {(Object.keys(OBSTACLE_LABELS) as ObstacleTypeKey[]).map((k) => (
              <div key={k} className="contents">
                <div
                  className="cy-mono text-xs"
                  style={{ color: ms.obstacles[k].count > 0 ? 'var(--cy-text)' : 'var(--cy-dim)' }}
                >
                  {OBSTACLE_LABELS[k]}
                </div>
                <NumField
                  value={ms.obstacles[k].count}
                  min={0}
                  max={20}
                  onChange={(n) => onChange({ ...ms, obstacles: { ...ms.obstacles, [k]: { ...ms.obstacles[k], count: n } } })}
                  width="w-14"
                />
                <NumField
                  value={ms.obstacles[k].size}
                  min={0.5}
                  max={3}
                  step={0.25}
                  onChange={(n) => onChange({ ...ms, obstacles: { ...ms.obstacles, [k]: { ...ms.obstacles[k], size: n } } })}
                  width="w-16"
                />
              </div>
            ))}
          </div>
          <div className="cy-mono text-[0.625rem] mt-2 pl-2" style={{ color: 'var(--cy-dim)' }}>
            кол-во 0 — тип отключён
          </div>
        </div>
      )}
    </div>
  );
}

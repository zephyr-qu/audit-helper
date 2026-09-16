<script lang="ts" setup>
import { computed } from 'vue';
import { appearanceToInlineStyle, resolveAppearance } from '@/utils/page-styles';
import { uid } from '@/utils/id';
import { LEVEL_COLOR_PALETTE } from '@/utils/settings';
import type { HighlightStyle, Level, LevelAction, LevelStyle } from '@/utils/types';

const levels = defineModel<Level[]>({ required: true });
const emit = defineEmits<{ remove: [id: string] }>();

/**
 * 处置动作：业务措辞（贴合规范第六章的管理措施）。
 * 每种动作归入一个行为级别，由行为级别决定结论、角标与排序。
 */
const ACTION_OPTIONS: Array<{ value: LevelAction; label: string }> = [
  { value: 'reject', label: '建议驳回' },
  { value: 'revise', label: '退回修改' },
  { value: 'verify', label: '人工核实' },
  { value: 'qualify', label: '补充资质' },
  { value: 'warn', label: '教育警示' },
  { value: 'hint', label: '仅作提示' },
];

const STYLE_OPTIONS: Array<{ value: LevelStyle; label: string }> = [
  { value: 'auto', label: '跟随处置' },
  { value: 'strong', label: '强' },
  { value: 'medium', label: '中' },
  { value: 'weak', label: '弱' },
  { value: 'plain', label: '极简' },
  { value: 'none', label: '无底色' },
];

const FORM_OPTIONS: Array<{ value: HighlightStyle; label: string }> = [
  { value: 'none', label: '无线' },
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'wavy', label: '波浪线' },
];

const canRemove = computed(() => levels.value.length > 1);

function add(): void {
  const used = new Set(levels.value.map((level) => level.color.toLowerCase()));
  const color =
    LEVEL_COLOR_PALETTE.find((item) => !used.has(item)) ??
    LEVEL_COLOR_PALETTE[levels.value.length % LEVEL_COLOR_PALETTE.length]!;
  levels.value = [
    ...levels.value,
    {
      id: uid('lv'),
      name: `档位 ${levels.value.length + 1}`,
      color,
      style: 'auto',
      form: 'solid',
      action: 'verify',
    },
  ];
}

/** 档位行里的实时高亮预览 */
function previewStyle(level: Level): Record<string, string> {
  return appearanceToInlineStyle(resolveAppearance(level), level.color);
}
</script>

<template>
  <div class="kw-levels">
    <div v-for="level in levels" :key="level.id" class="kw-level-row">
      <div class="kw-level-main">
        <input v-model="level.color" class="kw-color" type="color" title="主色" />
        <input v-model="level.name" class="kw-input kw-name" type="text" placeholder="档位名称" />
        <span class="kw-level-label">处置</span>
        <select v-model="level.action" class="kw-select-action" title="决定结论、角标与排序">
          <option v-for="option in ACTION_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <button
          class="kw-mini danger"
          type="button"
          title="删除档位"
          :disabled="!canRemove"
          @click="emit('remove', level.id)"
        >
          ×
        </button>
      </div>

      <div class="kw-level-meta">
        <span class="kw-level-label">外观</span>
        <select v-model="level.style" class="kw-select-style" title="外观：底色浓淡（跟随处置 / 强 / 中 / 弱）或极简 / 无底色">
          <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="kw-level-label">形式</span>
        <select v-model="level.form" class="kw-select-form" title="下划线线型：无线 / 实线 / 虚线 / 点线 / 波浪线">
          <option v-for="option in FORM_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="kw-level-preview" :style="previewStyle(level)">敏感词</span>
      </div>
    </div>

    <button class="kw-add" type="button" @click="add()">+ 新增档位</button>
  </div>
</template>

<script lang="ts" setup>
import { reactive } from 'vue';
import { formatKeywords, parseKeywords } from '@/utils/settings';
import type { KeywordGroup, Level } from '@/utils/types';

const groups = defineModel<KeywordGroup[]>({ required: true });
defineProps<{ levels: Level[] }>();
const emit = defineEmits<{ remove: [id: string] }>();

const expanded = reactive<Record<string, boolean>>({});
const drafts = reactive<Record<string, string>>({});

function commit(group: KeywordGroup): void {
  const next = parseKeywords(drafts[group.id] ?? '');
  group.keywords = next;
  drafts[group.id] = formatKeywords(next);
}

function toggle(group: KeywordGroup): void {
  if (expanded[group.id]) {
    commit(group);
    expanded[group.id] = false;
    return;
  }
  // 每次展开都从词库重新生成草稿，避免右键加词后编辑的是旧内容
  drafts[group.id] = formatKeywords(group.keywords);
  expanded[group.id] = true;
}
</script>

<template>
  <div class="kw-groups">
    <div v-for="group in groups" :key="group.id" class="kw-group">
      <div class="kw-group-head">
        <input v-model="group.enabled" class="kw-check" type="checkbox" :title="'启用该分组'" />
        <input v-model="group.name" class="kw-input" type="text" placeholder="分组名称" />
        <select v-model="group.levelId" class="kw-select">
          <option v-for="level in levels" :key="level.id" :value="level.id">{{ level.name }}</option>
        </select>
        <button class="kw-mini" type="button" :title="'编辑关键词'" @click="toggle(group)">
          {{ group.keywords.length }} 词
        </button>
        <button class="kw-mini danger" type="button" title="删除分组" @click="emit('remove', group.id)">
          ×
        </button>
      </div>
      <template v-if="expanded[group.id]">
        <textarea
          v-model="drafts[group.id]"
          class="kw-textarea"
          rows="6"
          spellcheck="false"
          placeholder="每行一个关键词，也支持逗号分隔"
          @change="commit(group)"
          @blur="commit(group)"
        />
        <input
          v-model="group.clause"
          class="kw-input"
          type="text"
          placeholder="条款依据，如 5.13.2（显示在问题清单上）"
        />
        <input
          v-model="group.advice"
          class="kw-input"
          type="text"
          placeholder="处理建议，如「删除任何收费表述」"
        />
        <label class="kw-inline">
          <input v-model="group.useRegex" type="checkbox" />
          该组按正则解析（用于手机号、微信变体等）
        </label>
      </template>
    </div>
    <p v-if="groups.length === 0" class="kw-empty">还没有分组，先新增一个。</p>
  </div>
</template>

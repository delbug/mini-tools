<script setup lang="ts">
import { onMounted } from 'vue';
import AppLayout from '@/layout/AppLayout.vue';
import { useConfig } from '@/composables/useConfig';

const { load } = useConfig();

onMounted(() => {
  load().catch(() => {});
});
</script>

<template>
  <AppLayout />
</template>

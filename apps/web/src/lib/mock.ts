import type { World, Agent } from './types';

export const mockWorlds: World[] = [
    {
        id: 'world-1',
        name: '夜之城 (Cyberpunk)',
        description: '充满霓虹与铬合金的未来都市，公司统治一切，底层民众在钢铁森林中挣扎求生。这里有最先进的义体和最廉价的人命。',
        image: 'https://placehold.co/600x400/1a1a1a/5b4dff?text=Cyberpunk+City'
    },
    {
        id: 'world-2',
        name: '维兰瑟大陆 (Velanthra)',
        description: '一个魔法与蒸汽朋克交织的奇幻世界。古代遗迹中埋藏着能够重塑现实的力量，而庞大的飞空艇正在连接原本隔绝的群岛。',
        image: 'https://placehold.co/600x400/2a3a2a/fdfcf9?text=Velanthra+Magic'
    }
];

export const mockAgents: Agent[] = [
    {
        id: 'agent-1',
        name: '薇可 (Vee)',
        description: '一名技术高超的黑客义体医生，性格冷淡但对熟人极度护短。',
        avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Vee',
        personality: '冷静、直接、毒舌'
    },
    {
        id: 'agent-2',
        name: '莫兰 (Morlan)',
        description: '自称“最后一位”的咒语编织者，总是在寻找能够重启古老魔法引擎的电池。',
        avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=Morlan',
        personality: '博学、古怪、乐观'
    }
];

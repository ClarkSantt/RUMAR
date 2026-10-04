import type { LoadType } from '../types';
export const muscleGroups = [
  'Peito',
  'Costas',
  'Ombros',
  'Bíceps',
  'Tríceps',
  'Antebraços',
  'Quadríceps',
  'Posteriores',
  'Glúteos',
  'Panturrilhas',
  'Abdômen',
  'Abdômen/Core',
  'Corpo inteiro',
  'Cardio',
  'Outro',
];
export const equipmentOptions = [
  'Barra',
  'Halteres',
  'Máquina',
  'Cabo',
  'Smith',
  'Elástico',
  'Peso corporal',
  'Outro',
];
export const loadLabels: Record<LoadType, string> = {
  total: 'Carga total',
  per_side: 'Carga por lado',
  per_dumbbell: 'Carga por halter',
  bodyweight: 'Peso corporal',
  none: 'Sem carga',
};

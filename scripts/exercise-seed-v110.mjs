// Curated local catalogue for migration 0012. Do not regenerate a migration after release.
// Format: name | equipment | load type | optional comma-separated aliases.
export const groups = {
  Peito: `
Supino reto com halteres|Halteres|per_dumbbell
Supino inclinado com barra|Barra|per_side
Supino declinado com barra|Barra|per_side
Supino declinado com halteres|Halteres|per_dumbbell
Supino horizontal na máquina|Máquina|total|chest press
Supino inclinado na máquina|Máquina|total
Supino convergente|Máquina|total
Supino reto no Smith|Smith|per_side
Supino inclinado no Smith|Smith|per_side
Crucifixo reto com halteres|Halteres|per_dumbbell
Crucifixo inclinado com halteres|Halteres|per_dumbbell
Crucifixo no cabo baixo|Cabo|total
Crucifixo no cabo alto|Cabo|total
Peck deck|Máquina|total|voador
Crossover na polia alta|Cabo|total
Crossover na polia baixa|Cabo|total
Flexão de braços|Peso corporal|bodyweight|push up
Flexão inclinada|Peso corporal|bodyweight
Flexão declinada|Peso corporal|bodyweight
Paralelas com ênfase em peito|Peso corporal|bodyweight
Pullover com halter|Halteres|per_dumbbell`,
  Costas: `
Barra fixa pronada|Peso corporal|bodyweight|pull up
Barra fixa supinada|Peso corporal|bodyweight|chin up
Barra fixa neutra|Peso corporal|bodyweight
Barra fixa assistida|Máquina|total
Puxada alta aberta|Cabo|total|pulley frente
Puxada alta fechada|Cabo|total
Puxada alta supinada|Cabo|total
Puxada alta neutra|Cabo|total
Puxada alta unilateral|Cabo|total
Puxada articulada|Máquina|total
Remada curvada com barra|Barra|per_side
Remada Pendlay|Barra|per_side
Remada cavalinho|Barra|total|t bar row
Remada articulada|Máquina|total
Remada unilateral na máquina|Máquina|total
Remada baixa com triângulo|Cabo|total
Remada baixa aberta|Cabo|total
Remada baixa unilateral|Cabo|total
Remada serrote com halter|Halteres|per_dumbbell
Remada com peito apoiado|Halteres|per_dumbbell
Remada invertida|Peso corporal|bodyweight
Remada no Smith|Smith|per_side
Remada alta para costas no cabo|Cabo|total
Pulldown com braços retos|Cabo|total
Pullover na máquina|Máquina|total
Encolhimento com barra|Barra|total
Encolhimento com halteres|Halteres|per_dumbbell
Levantamento terra convencional|Barra|per_side
Levantamento terra sumô|Barra|per_side
Hiperextensão lombar|Peso corporal|bodyweight`,
  Ombros: `
Desenvolvimento com barra|Barra|per_side
Desenvolvimento sentado com halteres|Halteres|per_dumbbell
Desenvolvimento em pé com halteres|Halteres|per_dumbbell
Desenvolvimento na máquina|Máquina|total
Desenvolvimento no Smith|Smith|per_side
Arnold press|Halteres|per_dumbbell
Elevação lateral no cabo|Cabo|total
Elevação lateral na máquina|Máquina|total
Elevação lateral unilateral|Halteres|per_dumbbell
Elevação frontal com halteres|Halteres|per_dumbbell
Elevação frontal com barra|Barra|total
Elevação frontal no cabo|Cabo|total
Crucifixo inverso com halteres|Halteres|per_dumbbell
Crucifixo inverso na máquina|Máquina|total
Face pull|Cabo|total
Elevação posterior no cabo|Cabo|total
Remada alta com barra|Barra|total
Remada alta no cabo|Cabo|total
Push press|Barra|per_side
Landmine press|Barra|per_side
Y raise inclinado|Halteres|per_dumbbell
Rotação externa no cabo|Cabo|total`,
  Bíceps: `
Rosca alternada|Halteres|per_dumbbell
Rosca martelo|Halteres|per_dumbbell
Rosca inclinada|Halteres|per_dumbbell
Rosca concentrada|Halteres|per_dumbbell
Rosca Scott com barra|Barra|total
Rosca Scott na máquina|Máquina|total
Rosca direta com barra W|Barra|total
Rosca direta no cabo|Cabo|total
Rosca unilateral no cabo|Cabo|total
Rosca bayesian|Cabo|total
Rosca spider|Halteres|per_dumbbell
Rosca 21|Barra|total
Rosca inversa|Barra|total
Rosca martelo com corda|Cabo|total
Rosca martelo cruzada|Halteres|per_dumbbell
Rosca Zottman|Halteres|per_dumbbell
Rosca na máquina articulada|Máquina|total
Barra fixa supinada com foco em bíceps|Peso corporal|bodyweight`,
  Tríceps: `
Tríceps testa com barra W|Barra|total
Tríceps testa com halteres|Halteres|per_dumbbell
Tríceps francês unilateral|Halteres|per_dumbbell
Tríceps francês com halter|Halteres|total
Tríceps francês no cabo|Cabo|total
Tríceps corda na polia|Cabo|total|pulley corda
Tríceps barra reta na polia|Cabo|total
Tríceps barra V na polia|Cabo|total
Tríceps unilateral na polia|Cabo|total
Tríceps coice com halter|Halteres|per_dumbbell
Tríceps coice no cabo|Cabo|total
Tríceps na máquina|Máquina|total
Supino fechado|Barra|per_side
Paralelas com foco em tríceps|Peso corporal|bodyweight
Mergulho no banco|Peso corporal|bodyweight
Flexão diamante|Peso corporal|bodyweight
Extensão acima da cabeça com corda|Cabo|total
JM press|Barra|per_side`,
  Antebraços: `
Flexão de punho com barra|Barra|total
Flexão de punho com halteres|Halteres|per_dumbbell
Extensão de punho com barra|Barra|total
Extensão de punho com halteres|Halteres|per_dumbbell
Rosca inversa no cabo|Cabo|total
Rosca martelo inclinada|Halteres|per_dumbbell
Farmer carry|Halteres|per_dumbbell
Dead hang|Peso corporal|bodyweight
Pronação de antebraço com halter|Halteres|per_dumbbell
Supinação de antebraço com halter|Halteres|per_dumbbell`,
  Quadríceps: `
Agachamento frontal|Barra|per_side
Agachamento goblet|Halteres|total
Agachamento no Smith|Smith|per_side
Agachamento hack|Máquina|total
Agachamento búlgaro|Halteres|per_dumbbell
Agachamento com peso corporal|Peso corporal|bodyweight
Agachamento sumô com halter|Halteres|total
Leg press 45 graus|Máquina|total
Leg press horizontal|Máquina|total
Leg press unilateral|Máquina|total
Cadeira extensora unilateral|Máquina|total
Avanço com halteres|Halteres|per_dumbbell
Avanço com barra|Barra|per_side
Passada caminhando|Halteres|per_dumbbell
Step up com halteres|Halteres|per_dumbbell
Sissy squat|Peso corporal|bodyweight
Agachamento ciclista|Halteres|total
Wall sit|Peso corporal|bodyweight`,
  Posteriores: `
Levantamento terra romeno|Barra|per_side
Levantamento terra romeno com halteres|Halteres|per_dumbbell
Stiff com barra|Barra|per_side
Stiff com halteres|Halteres|per_dumbbell
Mesa flexora unilateral|Máquina|total
Cadeira flexora|Máquina|total
Cadeira flexora unilateral|Máquina|total
Flexora em pé|Máquina|total
Flexora no cabo|Cabo|total
Nordic curl|Peso corporal|bodyweight
Good morning|Barra|per_side
Pull through no cabo|Cabo|total
Swing com kettlebell|Outro|total
Extensão lombar com foco em posteriores|Peso corporal|bodyweight
Ponte de isquiotibiais|Peso corporal|bodyweight
Flexão de joelho com elástico|Elástico|total
Deslizamento de isquiotibiais|Peso corporal|bodyweight`,
  Glúteos: `
Hip thrust com barra|Barra|per_side
Hip thrust na máquina|Máquina|total
Hip thrust unilateral|Peso corporal|bodyweight
Ponte de glúteos|Peso corporal|bodyweight
Ponte de glúteos com halter|Halteres|total
Coice no cabo|Cabo|total
Coice na máquina|Máquina|total
Abdução de quadril na máquina|Máquina|total
Abdução de quadril no cabo|Cabo|total
Abdução de quadril com elástico|Elástico|total
Agachamento sumô com barra|Barra|per_side
Levantamento terra sumô com halter|Halteres|total
Passada reversa com halteres|Halteres|per_dumbbell
Step up alto|Halteres|per_dumbbell
Frog pump|Peso corporal|bodyweight
Extensão de quadril no banco|Peso corporal|bodyweight`,
  Panturrilhas: `
Panturrilha em pé na máquina|Máquina|total
Panturrilha sentado na máquina|Máquina|total
Panturrilha no leg press|Máquina|total
Panturrilha no Smith|Smith|per_side
Panturrilha em pé com halteres|Halteres|per_dumbbell
Panturrilha unilateral em pé|Peso corporal|bodyweight
Panturrilha unilateral no leg press|Máquina|total
Panturrilha sentado com halter|Halteres|total
Panturrilha no degrau|Peso corporal|bodyweight
Panturrilha com elástico|Elástico|total
Panturrilha donkey|Máquina|total
Panturrilha isométrica|Peso corporal|bodyweight`,
  'Abdômen/Core': `
Prancha frontal|Peso corporal|bodyweight
Prancha lateral|Peso corporal|bodyweight
Prancha com carga|Outro|total
Abdominal crunch no solo|Peso corporal|bodyweight
Abdominal crunch no cabo|Cabo|total
Abdominal na máquina|Máquina|total
Abdominal bicicleta|Peso corporal|bodyweight
Elevação de pernas deitado|Peso corporal|bodyweight
Elevação de pernas suspenso|Peso corporal|bodyweight
Elevação de joelhos suspenso|Peso corporal|bodyweight
Abdominal reverso|Peso corporal|bodyweight
Ab wheel|Outro|none
Dead bug|Peso corporal|bodyweight
Bird dog|Peso corporal|bodyweight
Hollow body hold|Peso corporal|bodyweight
Pallof press no cabo|Cabo|total
Pallof press com elástico|Elástico|total
Woodchopper no cabo|Cabo|total
Russian twist|Peso corporal|bodyweight
Mountain climber|Peso corporal|bodyweight`,
  'Corpo inteiro': `
Burpee|Peso corporal|bodyweight
Thruster com halteres|Halteres|per_dumbbell
Thruster com barra|Barra|per_side
Clean com barra|Barra|per_side
Clean and press|Barra|per_side
Snatch com halter|Halteres|per_dumbbell
Turkish get up|Outro|total
Man maker|Halteres|per_dumbbell
Farmer walk com kettlebell|Outro|per_dumbbell
Sled push|Outro|none
Sled pull|Outro|none
Battle rope|Outro|none`,
  Cardio: `
Caminhada na esteira|Máquina|none
Corrida na esteira|Máquina|none
Bicicleta ergométrica|Máquina|none
Elíptico|Máquina|none
Remo ergométrico|Máquina|none
Escada ergométrica|Máquina|none
Pular corda|Outro|none
Corrida ao ar livre|Outro|none`,
};
export const exerciseSeeds = Object.entries(groups).flatMap(([muscle, text]) =>
  text
    .trim()
    .split('\n')
    .map((line) => {
      const [name, equipment, load_type, aliases = ''] = line.split('|');
      return {
        name,
        muscle,
        equipment,
        load_type,
        aliases: aliases ? aliases.split(',').map((a) => a.trim()) : [],
      };
    }),
);

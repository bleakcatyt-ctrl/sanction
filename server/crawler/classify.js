'use strict';
/** Классификация вакансий: релевантность ИИ, категория, уровень, стек. Чистые функции — легко тестировать. */

const DEV_TITLE = /\b(engineer|developer|programmer|software|backend|back-end|frontend|front-end|full[\s-]?stack|devops|sre|architect|data scien|scientist|researcher|ml|mlops|machine learning|llm|nlp|ai|разработчик|программист|инженер|data analyst|аналитик данных)\b/i;
const NON_DEV_TITLE = /\b(sales|marketing|recruit|talent|hr\b|account (manager|executive)|customer (success|support)|support specialist|content|copywriter|writer|designer|accountant|legal|counsel|nurse|driver|teacher|tutor|annotator|reviewer|rater|translator|moderator|operations support|business development|paralegal|bookkeeper|office manager|procurement)\b/i;

const CATEGORIES = [
  ['mlops', /\b(mlops|ml ?ops|ml (platform|infra\w*)|machine learning (platform|infra\w*|ops)|model serving|ai (infra\w*|platform)|inference (engineer|infra\w*)|gpu)\b/i],
  ['llm', /\b(llm|llms|large language|gen ?ai|generative|prompt|rag|agentic|ai agents?|agents? engineer|foundation model|langchain|openai|conversational ai|ai (engineer|developer|software))\b/i],
  ['cv', /\b(computer vision|vision|image|video|perception|ocr|lidar|slam|3d)\b/i],
  ['nlp', /\b(nlp|natural language|speech|voice|text|linguist\w*|asr|tts)\b/i],
  ['ds', /\b(data scien\w*|data analyst|analytics|statistic\w*|аналитик|data mining)\b/i],
  ['research', /\b(research (scientist|engineer)|applied scientist|researcher|research)\b/i],
  ['ml', /\b(machine learning|ml|deep learning|neural|artificial intelligence|ai\/ml|ai|reinforcement learning|recommend\w*|ranking|ml engineer)\b/i],
];

const AI_STRONG_TITLE = /\b(machine learning|deep learning|\bml\b|mlops|llm|llms|nlp|computer vision|data scien\w*|generative|gen ?ai|artificial intelligence|\bai\b|ai\/ml|neural|prompt|applied scientist|research scientist|research engineer|rag|reinforcement learning|нейро\w*|машинн\w+ обучен\w*|ml-\w+|ии|data scientist)\b/i;
const AI_BODY = /\b(machine learning|deep learning|llm|llms|large language models?|nlp|computer vision|neural network\w*|pytorch|tensorflow|transformers?|generative ai|genai|fine-?tun\w+|embedding\w*|rag\b|langchain|hugging ?face|reinforcement learning|mlops|scikit-learn|xgboost|нейронн\w+|машинное обучение)\b/gi;

/** [каноническое имя, regex] */
const STACK = [
  ['Python', /\bpython\b/i], ['PyTorch', /\bpy ?torch\b/i], ['TensorFlow', /\btensor ?flow\b/i], ['JAX', /\bjax\b/i],
  ['scikit-learn', /\bscikit[- ]?learn\b|\bsklearn\b/i], ['Hugging Face', /\bhugging ?face\b|\btransformers\b/i],
  ['LangChain', /\blang ?chain\b|\blanggraph\b/i], ['LlamaIndex', /\bllama ?index\b/i], ['OpenAI API', /\bopenai\b|\bgpt-?\d?\b/i],
  ['RAG', /\brag\b|retrieval[- ]augmented/i], ['LLM', /\bllms?\b|large language model/i], ['NLP', /\bnlp\b|natural language processing/i],
  ['Computer Vision', /\bcomputer vision\b|\bopencv\b/i], ['CUDA', /\bcuda\b/i], ['vLLM', /\bvllm\b/i], ['Triton', /\btriton\b/i], ['Ray', /\bray\b(?! tracing)/i],
  ['Vector DB', /\bpinecone\b|\bweaviate\b|\bqdrant\b|\bmilvus\b|\bpgvector\b|\bchroma(db)?\b|vector (db|database|store)/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i], ['Docker', /\bdocker\b/i], ['AWS', /\baws\b|amazon web services|sagemaker/i], ['GCP', /\bgcp\b|google cloud|vertex ai/i], ['Azure', /\bazure\b/i],
  ['MLflow', /\bmlflow\b/i], ['Airflow', /\bairflow\b/i], ['Spark', /\bspark\b|\bpyspark\b/i], ['Kafka', /\bkafka\b/i], ['SQL', /\bsql\b|\bpostgres(ql)?\b|\bmysql\b|\bclickhouse\b/i],
  ['FastAPI', /\bfastapi\b/i], ['Django', /\bdjango\b/i], ['Go', /\bgolang\b|\bgo\b(?= (developer|engineer|backend|and|or|,|\/))/i], ['Rust', /\brust\b/i],
  ['C++', /\bc\+\+/i], ['TypeScript', /\btypescript\b/i], ['JavaScript', /\bjavascript\b|\bnode\.?js\b/i], ['React', /\breact(\.js)?\b/i], ['Java', /\bjava\b(?!script)/i], ['Scala', /\bscala\b/i],
  ['Pandas', /\bpandas\b/i], ['NumPy', /\bnumpy\b/i], ['dbt', /\bdbt\b/i], ['Snowflake', /\bsnowflake\b/i], ['Databricks', /\bdatabricks\b/i],
  ['Terraform', /\bterraform\b/i], ['Linux', /\blinux\b/i], ['Git', /\bgit\b/i], ['REST', /\brest(ful)?\b/i], ['GraphQL', /\bgraphql\b/i],
  ['Reinforcement Learning', /reinforcement learning|\brlhf\b/i], ['Diffusion', /\bdiffusion\b|stable diffusion/i], ['Speech', /\basr\b|\btts\b|speech recognition/i],
  ['XGBoost', /\bxgboost\b|\blightgbm\b|\bcatboost\b/i], ['A/B-тесты', /\ba\/b test\w*|ab-?testing/i],
];

function extractStack(text, max = 14) {
  const out = [];
  for (const [name, re] of STACK) {
    if (re.test(text)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

function detectLevel(title, hint = '') {
  const t = `${title} ${hint}`.toLowerCase();
  if (/\b(intern|internship|trainee|стажер|стажёр)\b/.test(t)) return 'intern';
  if (/\b(team lead|tech lead|lead|head of|director|manager|architect|principal|тимлид|руководитель)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|staff|expert|старший|ведущий)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry[- ]level|graduate|new grad|младший)\b/.test(t)) return 'junior';
  return 'middle';
}

function classify({ title, tags = [], description = '' }) {
  const t = String(title || '');
  const tagText = tags.join(' ');
  const strongTitle = AI_STRONG_TITLE.test(t);
  const isDev = !NON_DEV_TITLE.test(t) && (DEV_TITLE.test(t) || (tags.some((x) => /^(python|java|golang|rust|c\+\+|node\.?js|javascript|typescript|backend|devops)/i.test(x)) && /\b(lead|manager)\b/i.test(t) === false));
  const body = `${description}`.slice(0, 6000);
  const hits = (body.match(AI_BODY) || []).length;
  const aiTag = /\b(ai|ml|machine learning|llm|data science|deep learning|nlp)\b/i.test(tagText);

  let score = 0;
  if (strongTitle) score = 75;
  else if (aiTag && isDev) score = 45;
  if (hits >= 6) score += 20; else if (hits >= 3) score += 12; else if (hits >= 1) score += 4;
  if (!strongTitle && !aiTag && hits >= 4 && isDev) score = Math.max(score, 40);
  if (strongTitle && aiTag) score += 5;
  score = Math.min(100, score);

  let category = 'dev';
  const hay = t + ' ' + (strongTitle ? '' : tagText);
  for (const [cat, re] of CATEGORIES) {
    if (re.test(t)) { category = cat; break; }
  }
  if (category === 'dev' && score >= 40) category = 'ml';
  if (category === 'dev' && !strongTitle && aiTag) category = 'ml';
  void hay;

  return {
    isDev: isDev || strongTitle,
    aiScore: score,
    category,
    level: detectLevel(t),
    stack: extractStack(`${t} ${tagText} ${body}`),
  };
}

const CATEGORY_LABELS = {
  llm: 'LLM и агенты', ml: 'ML-инженерия', mlops: 'MLOps и инфраструктура', cv: 'Компьютерное зрение',
  nlp: 'NLP и речь', research: 'Исследования', ds: 'Data Science', dev: 'Разработка',
};

module.exports = { classify, extractStack, detectLevel, CATEGORY_LABELS };

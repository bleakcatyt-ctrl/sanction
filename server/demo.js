'use strict';
/**
 * ДЕМО-данные для локальной разработки (VEKTOR_DEMO=1; в production запрещено).
 * Компании вымышленные, ссылки ведут на example.com. Интерфейс везде помечает такие вакансии как «Демо».
 * Прогоняются через тот же normalize()/classify(), что и настоящие вакансии.
 */
const { normalize, saveJobs } = require('./crawler');
const { resetStatsCache } = require('./jobs');

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

const COMPANIES = [
  'Нейрокод', 'Tensorbridge', 'Квант Лабс', 'Lumen Robotics', 'Саянский ИИ', 'Granite Data', 'Мозаика ML', 'Northwind Vision',
  'Парсек AI', 'Helix Speech', 'Облако Знаний', 'Vantage Agents', 'Тихий Океан Tech', 'Orbit Retrieval', 'Алгоритмика', 'Fjord Labs',
  'СинтезВоркс', 'Atlas Inference', 'Рябина Data', 'Kiln Systems',
];
const ROLES = [
  ['Senior LLM Engineer', 'LLM, RAG, Python, LangChain, vLLM'],
  ['ML Engineer', 'Python, PyTorch, MLflow, Docker'],
  ['Machine Learning Engineer, Ranking', 'PyTorch, Spark, Kafka, SQL'],
  ['AI Engineer (Agents)', 'OpenAI, LangGraph, FastAPI, Python, RAG'],
  ['Computer Vision Engineer', 'OpenCV, PyTorch, CUDA, C++'],
  ['NLP Engineer', 'Hugging Face, transformers, Python, NLP'],
  ['MLOps Engineer', 'Kubernetes, Airflow, MLflow, Terraform, AWS'],
  ['Data Scientist', 'Python, pandas, scikit-learn, SQL, A/B тесты'],
  ['Research Engineer, Foundation Models', 'PyTorch, JAX, CUDA, distributed training'],
  ['Junior ML Engineer', 'Python, scikit-learn, pandas'],
  ['Lead AI Engineer', 'LLM, fine-tuning, RAG, Kubernetes'],
  ['Backend Engineer (ML Platform)', 'Go, Kubernetes, Python, Kafka'],
  ['Speech Recognition Engineer', 'ASR, TTS, PyTorch, C++'],
  ['Prompt Engineer / AI Developer', 'OpenAI, LLM, Python, TypeScript'],
  ['Senior Python Developer', 'Python, FastAPI, PostgreSQL, Docker'],
  ['Full-Stack Engineer (AI products)', 'TypeScript, React, Python, OpenAI'],
  ['Applied Scientist', 'Python, PyTorch, reinforcement learning, A/B тесты'],
  ['Inference Optimization Engineer', 'CUDA, Triton, vLLM, C++'],
];
const PLACES = [['Remote (EU)', 1], ['Москва', 0], ['Remote', 1], ['Санкт-Петербург', 0], ['Remote (Worldwide)', 1], ['Berlin', 0], ['Remote (CIS)', 1]];
const SALARY = [null, null, { min: 250000, max: 380000, currency: 'RUB', period: 'monthly' }, { min: 90000, max: 140000, currency: 'USD', period: 'annual' }, { min: 120000, max: 170000, currency: 'EUR', period: 'annual' }, { min: 400000, max: 600000, currency: 'RUB', period: 'monthly' }];

function seed(db) {
  if (db.prepare("SELECT COUNT(*) c FROM jobs WHERE source = 'demo'").get().c > 0) return;
  const rand = rng(42);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const t = Date.now();
  const rows = [];
  for (let i = 0; i < 110; i++) {
    const [title, stack] = pick(ROLES);
    const company = pick(COMPANIES);
    const [location, remote] = pick(PLACES);
    const ageH = Math.floor(Math.pow(rand(), 1.6) * 24 * 21);
    const raw = {
      ext_id: 'demo-' + i, title, company, location, remote: !!remote, url: `https://example.com/demo/${i}`,
      description: `<p>Мы расширяем команду и ищем специалиста на роль «${title}».</p><h3>Чем предстоит заниматься</h3><ul><li>Проектировать и запускать в прод ML-системы и сервисы вокруг моделей</li><li>Работать с данными, экспериментами и метриками качества</li><li>Улучшать инфраструктуру обучения и инференса</li></ul><h3>Наш стек</h3><p>${stack}</p><h3>Мы предлагаем</h3><ul><li>Гибкий график, возможность удалённой работы</li><li>ДМС и бюджет на обучение</li></ul><p>Это демонстрационная вакансия — настоящие появятся после первого сбора с источников.</p>`,
      tags: [], posted_at: t - ageH * 3600_000, salary: pick(SALARY),
    };
    const n = normalize(raw, 'demo');
    if (n) rows.push(n);
  }
  saveJobs(db, rows);
  resetStatsCache();
  console.log(`[demo] загружено демо-вакансий: ${rows.length}`);
}

module.exports = { seed };

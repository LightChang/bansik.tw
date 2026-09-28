// 機構頁 <title>／description 用的本名：去掉法人別與「(時段)」類註記，其他括號保留。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreName, titleNames } from '../src/lib/placepages.mjs';

test('去掉開頭法人別與結尾註記（半形、全形括號）', () => {
  assert.equal(coreName('社團法人全腦科學教育協會(時段)'), '全腦科學教育協會');
  assert.equal(coreName('財團法人某某基金會（健保特約、時段）'), '某某基金會');
  assert.equal(coreName('某某發展中心(日間、時段、到宅)'), '某某發展中心');
  assert.equal(coreName('某某協會(114.09.17核可)'), '某某協會');
});

test('區分不同單位的括號保留', () => {
  assert.equal(coreName('高雄市立小港醫院(委託財團法人私立高雄醫學大學經營)'), '高雄市立小港醫院(委託財團法人私立高雄醫學大學經營)');
  assert.equal(coreName('某某中心(西區-到宅)'), '某某中心(西區-到宅)');
  assert.equal(coreName('(三重)活力復健診所'), '(三重)活力復健診所');
});

test('去完太短就用原名', () => {
  assert.equal(coreName('財團法人'), '財團法人');
  assert.equal(coreName('(時段)'), '(時段)');
});

test('同縣市去掉註記後撞名，兩家都用全名', () => {
  const c = { entities: [
    { entity_key: 'a', name: '某某中心(日間)' },
    { entity_key: 'b', name: '某某中心(時段)' },
    { entity_key: 'c', name: '社團法人甲協會(時段)' },
    { entity_key: 'd', name: '乙協會(時段)' },
    { entity_key: 'e', name: '乙協會' },
  ] };
  const m = titleNames(c);
  assert.equal(m.get('a'), '某某中心(日間)');
  assert.equal(m.get('b'), '某某中心(時段)');
  assert.equal(m.get('c'), '甲協會');
  assert.equal(m.get('d'), '乙協會(時段)');
  assert.equal(m.get('e'), '乙協會');
});

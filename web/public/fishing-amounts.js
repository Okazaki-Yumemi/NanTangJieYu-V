'use strict';

/* 厘米整数：小数值兼容旧存档，大数值用十进制字符串跨 JSON 传输。 */
(function exposeAmounts(root) {
  const LIGHT_YEAR_CM=946073047258080000n;
  function integer(value) {
    if(typeof value==='bigint')return value>=0n?value:0n;
    if(typeof value==='number')return Number.isSafeInteger(value) && value>=0?BigInt(value):0n;
    return typeof value==='string' && /^\d{1,1024}$/.test(value)?BigInt(value):0n;
  }
  function serialize(value) {const n=integer(value);return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n.toString();}
  function add(a,b){return serialize(integer(a)+integer(b));}
  function subtract(a,b){return serialize(integer(a)>integer(b)?integer(a)-integer(b):0n);}
  function compare(a,b){const x=integer(a),y=integer(b);return x===y?0:x>y?1:-1;}
  function decimal(n,unit){const scaled=(n*100n+unit/2n)/unit;const fraction=(scaled%100n).toString().padStart(2,'0').replace(/0+$/,'');return `${scaled/100n}${fraction?'.'+fraction:''}`;}
  function format(value,metresOnly=false){
    const n=integer(value);
    if(n>=LIGHT_YEAR_CM)return `${decimal(n,LIGHT_YEAR_CM)} 光年`;
    if(n>=14959787070000n)return `${decimal(n,14959787070000n)} 天文单位`;
    if(n>=100000n)return `${decimal(n,100000n)} 千米`;
    if(metresOnly || n>=100n)return `${decimal(n,100n)} 米`;
    return `${n} 厘米`;
  }
  const api={LIGHT_YEAR_CM,integer,serialize,add,subtract,compare,format};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.FishingAmounts=api;
})(typeof window==='undefined'?globalThis:window);

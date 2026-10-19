/** Shared GLSL: hash/noise + analytic sky + sun/moon + clouds.
 *  Used by the sky dome, the water shader (reflections) and image-based lighting. */
export const NOISE_GLSL = /* glsl */`
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x),
             mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float n000 = fract(sin(dot(i+vec3(0,0,0), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n100 = fract(sin(dot(i+vec3(1,0,0), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n010 = fract(sin(dot(i+vec3(0,1,0), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n110 = fract(sin(dot(i+vec3(1,1,0), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n001 = fract(sin(dot(i+vec3(0,0,1), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n101 = fract(sin(dot(i+vec3(1,0,1), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n011 = fract(sin(dot(i+vec3(0,1,1), vec3(12.9898,78.233,37.719)))*43758.5453);
  float n111 = fract(sin(dot(i+vec3(1,1,1), vec3(12.9898,78.233,37.719)))*43758.5453);
  return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
             mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p *= 2.03; p += vec2(1.7,9.2); a *= 0.5; }
  return s;
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<4;i++){ s += a*vnoise3(p); p *= 2.07; a *= 0.5; }
  return s;
}
`;

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uMoonColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform float uTime;
uniform float uCloudiness;
uniform float uNight;
uniform float uOvercast;
uniform vec2 uWindDir;
uniform float uRain;

float cloudField(vec2 uv, float t){
  vec2 p = uv * 2.4;
  p += uWindDir * t * 0.016;
  float n = fbm(p);
  float n2 = fbm(p * 2.7 + vec2(t*0.01, -t*0.008));
  return n * 0.72 + n2 * 0.28;
}

vec3 skyColor(vec3 dir){
  float h = clamp(dir.y, -1.0, 1.0);
  float up = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, up);

  // below-horizon (ground haze / distant terrain fade)
  col = mix(col, uHaze * 0.9, smoothstep(0.02, -0.12, h));

  float sunDot = max(dot(dir, uSunDir), 0.0);
  // broad forward-scattering halo near the sun
  col += uSunColor * pow(sunDot, 6.0) * 0.28 * (1.0 - uOvercast*0.7);
  col += uSunColor * pow(sunDot, 900.0) * 6.0 * (1.0 - uOvercast);
  // horizon warm band at sunrise / sunset
  float sunH = clamp(uSunDir.y, -1.0, 1.0);
  float golden = (1.0 - abs(sunH) * 3.2);
  golden = clamp(golden, 0.0, 1.0);
  float band = pow(1.0 - abs(h), 8.0) * pow(max(sunDot, 0.0), 2.0);
  col += vec3(1.0, 0.52, 0.22) * band * golden * 0.65 * (1.0 - uOvercast*0.75);
  col += vec3(0.35, 0.22, 0.42) * pow(1.0 - abs(h), 6.0) * uNight * 0.30;

  // moon
  float moonDot = max(dot(dir, uMoonDir), 0.0);
  col += uMoonColor * pow(moonDot, 2200.0) * 5.0 * uNight;
  col += uMoonColor * pow(moonDot, 12.0) * 0.10 * uNight;

  // stars
  if (uNight > 0.01) {
    float s = pow(vnoise3(dir * 190.0), 22.0);
    float tw = 0.65 + 0.35 * sin(uTime * 2.4 + hash11(dot(floor(dir*190.0), vec3(1.0))) * 40.0);
    col += vec3(0.95, 0.97, 1.0) * s * 26.0 * uNight * tw * (1.0 - uOvercast*0.85) * smoothstep(-0.05, 0.15, h);
    float milky = pow(vnoise3(dir * 3.2 + 11.0), 3.0) * 0.05;
    col += vec3(0.6,0.7,1.0) * milky * uNight * (1.0-uOvercast);
  }
  return col;
}

vec3 cloudColor(vec3 dir, out float cover){
  if (dir.y <= 0.02) { cover = 0.0; return vec3(0.0); }
  vec2 uv = dir.xz / max(dir.y, 0.045) * 0.055;
  float t = uTime;
  float n = cloudField(uv, t);
  float thr = mix(0.62, 0.34, uCloudiness);
  cover = smoothstep(thr, thr + 0.22, n) * smoothstep(0.0, 0.18, dir.y);
  float sunDot = max(dot(dir, uSunDir), 0.0);
  float moonDot = max(dot(dir, uMoonDir), 0.0);

  vec3 lit = uSunColor * (0.85 + 1.4 * pow(sunDot, 3.0));
  lit += vec3(1.0, 0.86, 0.68) * pow(sunDot, 22.0) * 1.6 * (1.0 - uOvercast*0.6);
  vec3 nightLit = uMoonColor * 0.55 + vec3(0.10, 0.12, 0.18);
  vec3 base = mix(lit, nightLit, uNight);

  // fake self-shadowing: darker where the field is dense
  float dens = smoothstep(thr, thr + 0.42, n);
  vec3 shadow = base * 0.34 + uHaze * 0.22;
  vec3 col = mix(shadow, base, 1.0 - dens * 0.75);
  col = mix(col, uHaze * 1.05, uOvercast * 0.45);
  return col;
}
`;

export const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // force far plane
}
`;

export const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
${NOISE_GLSL}
${SKY_GLSL}
void main(){
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);
  float cover;
  vec3 cc = cloudColor(dir, cover);
  col = mix(col, cc, clamp(cover, 0.0, 1.0));
  // subtle high-altitude desaturation for a painterly look
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(col, vec3(lum), 0.08);
  gl_FragColor = vec4(col, 1.0);
}
`;

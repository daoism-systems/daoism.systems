//import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
//import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass'
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass'
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader'
//import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

import { BloomEffect, EffectComposer, EffectPass, RenderPass, ShaderPass, KawaseBlurPass } from "postprocessing";
import { useThree, useFrame } from '@react-three/fiber'
import { useRef, useMemo, useEffect, } from 'react'
import { useControls } from 'leva'
import * as THREE from 'three'
import { useScroll } from '@react-three/drei'
import { SMAA } from '@react-three/postprocessing';


export default function Effects() {

  const swap = useRef(false)
  const { scene, gl, camera, size } = useThree()
  const { renderTa, renderTb } = useMemo(() => {
    const renderTa = new THREE.WebGLRenderTarget(size.width, size.height)
    const renderTb = new THREE.WebGLRenderTarget(size.width, size.height)
    return { renderTa, renderTb }
  }, [size])

  let mobile
  if (window.matchMedia("(max-width:768px)").matches) {
    mobile = true
  }
  else {
    mobile = false
  }

  const PixelRatio = 1

  const [final1, finalP1, finalPass, blur2] = useMemo(() => {

    const triColorMix = new THREE.ShaderMaterial({
      precision: 'lowp',
      uniforms: {
        tDiffuse1: { value: null },
        uGlitch: { value: 0 },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uMouse: { value: new THREE.Vector2(0.7, 0.5) },
        uStr: { value: 1.0 }
      },
      vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
      }
    `,
      fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tDiffuse1;
      uniform float uGlitch;
      uniform vec2 uMouse;
      uniform float uStr;
      uniform vec2 uResolution;
      #define PI 3.1415926535897932384626433832795

      float EaseOutSine(float x)
{
    return cos((x * PI) / 2.0);
}

float EaseInSine(float x)
{
    return 1.0 - cos((x * PI) / 2.0);
}

float EaseInOutSine(float x)
{ 
    return -(cos(PI * x) - 1.0) / 2.0;
}    


      void main() {

          vec2 Ruv = vUv.xy;
          vec2 lens_uv = vUv.xy;
          vec2 lens_pos = uMouse.xy;

          vec2 lens_delta = (lens_uv - lens_pos);
          float lens_dist = length(lens_delta);
        
          float lens_radius = 2.5;
          float lens_zoom = 0.5;
        
          float lens_radius_fudge = 4.;
          vec3 lens_normal =
              normalize(vec3(lens_delta.xy, lens_zoom * sqrt(lens_radius_fudge * lens_radius - lens_dist*lens_dist)));

          vec3 incident = normalize(vec3(0.0, 0.0, -1.0));
           
          
          float eta_r = 1.0 / 1.15;
          float eta_y = 1.0 / 1.19;
          float eta_g = 1.0 / 1.23;
          float eta_c = 1.0 / 1.25;
          float eta_b = 1.0 / 1.27;
          float eta_v = 1.0 / 1.30;
           
         
        float minUgli = min(EaseOutSine(uGlitch * 0.5), 0.0) * uStr;
        float minUgliM1 = min(-EaseOutSine(uGlitch * 0.5), 0.0) * uStr;


        if(minUgli < 0.0) {
         eta_r = 1.0 / 1.15 + minUgli * 0.1;
         eta_y = 1.0 / 1.15 + minUgli * 0.12;
         eta_g = 1.0 / 1.15 + minUgli * 0.15;
         eta_c = 1.0 / 1.15 + minUgli * 0.19;
         eta_b = 1.0 / 1.15 + minUgli * 0.15;
         eta_v = 1.0 / 1.15 + minUgli * 0.23;
        } else {
          eta_r = 1.0 / 1.15 + minUgliM1 * 0.1;
          eta_y = 1.0 / 1.15 + minUgliM1 * 0.12;
          eta_g = 1.0 / 1.15 + minUgliM1 * 0.15;
          eta_c = 1.0 / 1.15 + minUgliM1 * 0.19;
          eta_b = 1.0 / 1.15 + minUgliM1 * 0.15;
          eta_v = 1.0 / 1.15 + minUgliM1 * 0.23;
        }


          vec2 refract_r = refract(incident, lens_normal, eta_r).xy;
          vec2 refract_y = refract(incident, lens_normal, eta_y).xy;
          vec2 refract_g = refract(incident, lens_normal, eta_g).xy;
          vec2 refract_c = refract(incident, lens_normal, eta_c).xy;
          vec2 refract_b = refract(incident, lens_normal, eta_b).xy;
          vec2 refract_v = refract(incident, lens_normal, eta_v).xy;
        
          vec3 tex = texture(tDiffuse1, Ruv).rgb;
          vec3 tex_r = texture(tDiffuse1, refract_r + Ruv).rgb;
          vec3 tex_y = texture(tDiffuse1, refract_y + Ruv).rgb;
          vec3 tex_g = texture(tDiffuse1, refract_g + Ruv).rgb;
          vec3 tex_c = texture(tDiffuse1, refract_c + Ruv).rgb;
          vec3 tex_b = texture(tDiffuse1, refract_b + Ruv).rgb;
          vec3 tex_v = texture(tDiffuse1, refract_v + Ruv).rgb;
        
          float r = tex_r.r * 0.5;
          float g = tex_g.g * 0.5;
          float b = tex_b.b * 0.5;
          float y = dot(vec3(2.0, 2.0, -1.0), tex_y)/6.0;
          float c = dot(vec3(-1.0, 2.0, 2.0), tex_c)/6.0;
          float v = dot(vec3(2.0, -1.0, 2.0), tex_v)/6.0;
        
          float R = r + (2.0 * v + 2.0 * y - b)/3.0;
          float G = y + (2.0 * y + 2.0 * c - y)/3.0;
          float B = b + (2.0 * c + 2.0 * c - v)/3.0;

          vec3 color = mix(tex, vec3(R * 2., G * 2., B * 2.), step(lens_dist, lens_radius));

          gl_FragColor = vec4(color, 1.0);
      }
    `
    })

    /*
    const blurMat = new THREE.ShaderMaterial({
      precision:'lowp',
      uniforms: {
        "tDiffuse": { value: null },
        "resolution":   { value: new THREE.Vector2(size.width, size.height).multiplyScalar(0.8) },
        "blurSize": { value: 0.0 }
      },
      vertexShader: 
      `varying vec2 v_uv;
      
      void main() {
        v_uv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
          fragmentShader: 
     `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float blurSize;
  
      varying vec2 v_uv;
  
      vec4 blur(sampler2D tex){
        const float PI2 = 6.28318530718; // Pi*2
      
        const float directions = 16.0;
        const float quality = 2.;
     
        vec2 radius = blurSize/resolution;
      
        vec2 uv = (gl_FragCoord.xy/resolution);
  
        vec4 color = texture2D(tex, uv);
      
        int count = 1;
        for( float theta=0.0; theta<PI2; theta+=PI2/directions)
        {
          vec2 dir = vec2(cos(theta), sin(theta)) * radius;
          for(float i=1.0/quality; i<=1.0; i+=1.0/quality)
          {
            color += texture2D( tex, uv+dir*i);	
            count++;
          }
        }
      
        color /= float(count);
        
        return color;
      }
      
      void main (void)
      {
        gl_FragColor = blur(tDiffuse); 
      }`
    }
   );
   */


    const finalComposer = new EffectComposer(gl);
    finalComposer.addPass(new RenderPass(scene, camera));
    const finalPass = new ShaderPass(triColorMix, 'tDiffuse1');
    const blurPass1 = new KawaseBlurPass({
      height: 1080
    })
    blurPass1.scale = 0
    finalComposer.addPass(blurPass1)
    finalComposer.addPass(finalPass);

    return [finalComposer, triColorMix, finalPass, blurPass1];
  }, []);

  const times = [];
  let fps;
  useEffect(() => {
    final1.setSize(window.innerWidth, window.innerHeight)
    gl.setSize(window.innerWidth, window.innerHeight)
    window.addEventListener('resize', () => {
      final1.setSize(size.width, size.height)
      gl.setSize(size.width, size.height)
    })

    function refreshLoop() {
      window.requestAnimationFrame(() => {
        const now = performance.now();
        while (times.length > 0 && times[0] <= now - 1000) {
          times.shift();
        }
        times.push(now);
        fps = times.length;
        // console.log(fps)
        refreshLoop();
      });
    }

    refreshLoop();

  }, [size, final1])

  const data = useScroll()
  let check = true

  useFrame((state) => {
    finalP1.uniforms['uGlitch'].value = state.clock.elapsedTime

    if (!mobile) {
      if (data.offset < 0.11) {
        finalP1.uniforms['uMouse'].value.x = 0.7
        blur2.scale = 0
      }
      else if (data.offset > 0.11 && data.offset < 0.13) {
        finalP1.uniforms['uMouse'].value.x = 0.37
        if (blur2.scale < 5) {
          blur2.scale += 0.25
        }

      }
      else if (data.offset > 0.13 && data.offset < 0.215 && blur2.scale > 0) {
        finalP1.uniforms['uMouse'].value.x = 0.37
        blur2.scale -= 0.25
        if (!check) {
          // final1.addPass(finalPass)
          check = true
        }
      }
      else if (data.offset > 0.215 && data.offset < 0.24) {
        /*
         if(check){
           final1.removePass(finalPass)
           check = !check
         }
         */
        finalP1.uniforms['uMouse'].value.x = 0.7
        finalP1.uniforms['uStr'].value = 1
        if (blur2.scale < 5) {
          blur2.scale += 0.25
        }

      }
      else if (data.offset > 0.24 && data.offset < 0.3 && blur2.scale > 0) {
        /*
         if(check){
           final1.removePass(finalPass)
           check = !check
         }
         */
        finalP1.uniforms['uStr'].value = 0.7
        finalP1.uniforms['uMouse'].value.x = 0.7
        blur2.scale -= 0.25


      }
      else if (data.offset > 0.3 && data.offset < 0.434 && blur2.scale > 0) {
        blur2.scale -= 0.5
      }
      else if (data.offset > 0.43 && data.offset < 0.45) {
        finalP1.uniforms['uMouse'].value.x = 0.30
        if (blur2.scale < 5) {
          blur2.scale += 0.25
        }

      }
      else if (data.offset > 0.45 && data.offset < 0.5 && blur2.scale > 0) {
        finalP1.uniforms['uStr'].value = 0.7
        finalP1.uniforms['uMouse'].value.x = 0.28
        blur2.scale -= 0.25

      }
    }
    else {
      if (data.offset < 0.16) {
        finalP1.uniforms['uMouse'].value.x = 0.5
        finalP1.uniforms['uMouse'].value.y = 0.6
        blur2.scale = 0
      }
      else if (data.offset > 0.16 && data.offset < 0.19 && blur2.scale < 5) {
        blur2.scale += 0.5
      }
      else if (data.offset > 0.19 && data.offset < 0.30 && blur2.scale > 0) {
        blur2.scale -= 0.5
      }
      else if (data.offset > 0.30 && data.offset < 0.32 && blur2.scale < 5) {
        blur2.scale += 0.5
      }
      else if (data.offset > 0.32 && data.offset < 0.405 && blur2.scale > 0) {
        blur2.scale -= 0.5
        finalP1.uniforms['uMouse'].value.x = 0.5
        finalP1.uniforms['uMouse'].value.y = 0.6
      }
      else if (data.offset > 0.405 && data.offset < 0.425 && blur2.scale < 5) {
        blur2.scale += 0.5
        finalP1.uniforms['uMouse'].value.x = 0.4
        finalP1.uniforms['uMouse'].value.y = 0.65
      }
      else if (data.offset > 0.425 && data.offset < 0.50 && blur2.scale > 0) {
        blur2.scale -= 0.5
      }


    }

    gl.autoClear = false;
    gl.clear()
    gl.clearColor()
    camera.layers.set(1)
    final1.render()
    gl.clearDepth();
    camera.layers.set(0);
    gl.render(scene, camera);

  }, 1)

  return null

}

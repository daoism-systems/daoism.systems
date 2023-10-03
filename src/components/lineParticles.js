import React, { useRef, useMemo, useEffect, useState } from 'react'
import { useGLTF, PerspectiveCamera, useAnimations} from '@react-three/drei'
import { extend, useFrame, useLoader } from "@react-three/fiber"
import { TextureLoader } from 'three/src/loaders/TextureLoader'



import * as THREE from "three"

export default function LineParticles({ nodesName,  rotationElem, scaleElem, speed }) {
    const renderRef = useRef()
    const ref = useRef();

    const texureTest = useLoader(TextureLoader, 'texturedot.png');

    const fragmentShader = `
    #ifdef GL_ES
   precision mediump float;
  #endif
  
  uniform vec2 resolution;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;
  uniform sampler2D uTexture;
  varying float vColorRandom;
  varying float vRandom;
  
  #define PI 3.1415926535897932384626433832795
  
  varying vec2 vUv;
  
  void main(){
  
    float alpha = 1. - smoothstep(-0.2,0.5,length(gl_PointCoord - vec2(0.5)));
  
    vec3 finalColor = mix(uColor1, uColor2, length(gl_PointCoord - vec2(0.5)));

    
    gl_FragColor = vec4(finalColor, 0.5);
    //gl_FragColor = vec4(finalColor, alpha);
    gl_FragColor = gl_FragColor * texture2D( uTexture, gl_PointCoord );
  
  }
`;

    const vertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying float vColorRandom;
  varying float vRandom;
  uniform float uTime;
  
  
  attribute float randoms;
  attribute float colorRandoms;
  void main()
  {
      vUv = uv;
      vRandom = randoms;
      
      vec3 pos = position;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.);
      gl_PointSize = (30. * randoms) * (20. / - mvPosition.z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
  `

    const dataOctagon = useMemo(
      () => ({
        extensions: {
          derivatives: "#extension GL_OES_standard_derivatives : enable"
        },
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0.0 },
          /////////////////////////////////////
          //Here the two colors of the animation
          //////////////////////////////////////
          uColor1: { value: new THREE.Color("#AACCFF") },
          uColor2: { value: new THREE.Color("#FFFFFF") },
         uColor3: { value: new THREE.Color(0x0000FF) },
         uColor4: { value: new THREE.Color(0xDDDDDD) },
          resolution: { value:  new THREE.Vector2(window.innerWidth, window.innerHeight) },
          uTexture: { value: texureTest }
        },
        fragmentShader: fragmentShader,
        vertexShader: vertexShader,
        transparent: true,
        depthWrite: false,
      }),
      []
    )

    console.log(nodesName, 'nodesName');

    const totalCount = nodesName.geometry.attributes.position.array.length;

    let randoms = new Float32Array(totalCount);
    let colorRandoms = new Float32Array(totalCount);

    console.log(totalCount)


    for (let i = 0; i < totalCount /3; i++) {
      randoms.set(0, i);
      colorRandoms.set([Math.random(1)], i);

    }



    nodesName.geometry.setAttribute('randoms', new THREE.BufferAttribute(randoms, 1))
    nodesName.geometry.setAttribute('colorRandoms', new THREE.BufferAttribute(colorRandoms, 1))

    useFrame((state) => {

      dataOctagon.uniforms.uTime.value = state.clock.elapsedTime;

      /*
      updatePos(state.clock.elapsedTime)
      */


      for(let i = 144 - 1; i >=0 ; i--) {


       nodesName.geometry.attributes.randoms.array[i] =  Math.sin((i * 6) + state.clock.elapsedTime * speed) * 1.5
       // nodesName.geometry.attributes.randoms.array[i] = (Math.sin((i) + (state.clock.elapsedTime * 1)) * 2)
        nodesName.geometry.attributes.randoms.needsUpdate = true;


      }

    });


    return (
        <points name={nodesName.name} geometry={nodesName.geometry} material={nodesName.material} scale={scaleElem} rotation={rotationElem}>
            <shaderMaterial ref={renderRef} attach="material" {...dataOctagon} />
        </points>
    )
} 
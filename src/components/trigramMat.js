import React, { useRef, useMemo, useEffect, useState } from 'react'
import { useGLTF, PerspectiveCamera, useAnimations } from '@react-three/drei'
import { extend, useFrame, useLoader } from "@react-three/fiber"



import * as THREE from "three"

export default function TrigramMesh({ nodesName, positionElem, rotationElem, scaleElem }) {
  const renderRef = useRef()
  const ref = useRef();

  const fragmentShader = `
    #ifdef GL_ES
   precision mediump float;
  #endif
  

  uniform vec3 uColor1;

  
  #define PI 3.1415926535897932384626433832795
  
  varying vec2 vUv;
  
  void main(){
  
    float alpha = 1. - smoothstep(-0.2,0.5,length(gl_PointCoord - vec2(0.5)));
  
    vec3 finalColor = uColor1;

    gl_FragColor = vec4(finalColor, 1.);
    gl_FragColor = vec4(finalColor, alpha);
  
  }
`;

  const vertexShader = `

  void main()
  {

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
      gl_PointSize = 7. * (20. / - mvPosition.z);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `

  const dataOctagon = useMemo(
    () => ({
      extensions: {
        derivatives: "#extension GL_OES_standard_derivatives : enable"
      },
      side: THREE.DoubleSide,
      uniforms: {

        uColor1: { value: new THREE.Color("#FFFFFF") },

      },
      fragmentShader: fragmentShader,
      vertexShader: vertexShader,
      transparent: true,
      depthWrite: false,
    }),
    []
  )


  /*
  useFrame((state) => {

  });
  */


  return (
    <points name={nodesName.name} layers={1} geometry={nodesName.geometry} material={nodesName.material} position={positionElem} scale={scaleElem} rotation={rotationElem}>
      <shaderMaterial ref={renderRef} attach="material" {...dataOctagon} />
    </points>
  )
}
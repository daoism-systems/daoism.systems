import React, { useRef, useMemo, useEffect, useState } from 'react'
import { useGLTF, PerspectiveCamera, useAnimations } from '@react-three/drei'
import { extend, useFrame, useLoader } from "@react-three/fiber"
import * as THREE from "three"

export default function ParticlesBackground() {
  const renderRef = useRef()
  const ref = useRef()

  const fragmentShader = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    
    uniform vec2 resolution;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform sampler2D uTexture;
    
    #define PI 3.1415926535897932384626433832795
    
    varying vec2 vUv;
    
    
    void main(){
    
        float alpha = 1. - smoothstep(-0.2,0.5,length(gl_PointCoord - vec2(0.5)));
    
        vec3 finalColor = vec3(0.);
        finalColor = mix(uColor1, uColor2, length(gl_PointCoord - vec2(0.5)));
        gl_FragColor = vec4(finalColor, 0.1);
        gl_FragColor = vec4(finalColor, alpha);
}`
  const vertexShader = `
    varying vec2 vUv;
    attribute float random;
    uniform float uSize;
    uniform float uTime;
    #define PI 3.1415926535897932384626433832795
    float EaseOutSine(float x)
{
    return sin((x * PI) / 2.0);
}
    void main() {
        vUv = uv;
        vec3 pos = position;
        pos.x += EaseOutSine(pos.y)  + uTime  * 0.001 ;
        pos.y += EaseOutSine(pos.x)  + uTime  * 0.001 ;
        vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );
        gl_PointSize = (27. * (random * uSize)) * (20. / - mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }`


  const shaderDat = useMemo(
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
        uColor1: { value: new THREE.Color("#888888") },
        uColor2: { value: new THREE.Color("#111111") },
        uColor3: { value: new THREE.Color("#ffffff") },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uSize: { value: 0.6 }
      },
      fragmentShader: fragmentShader,
      vertexShader: vertexShader,
      transparent: true,
      depthWrite: false,
    }),
    []
  )



  useEffect(() => {
    const number = ref.current.attributes.position.array.length

    const randomArr = new Float32Array(number)

    for (let i = 0; i < number; i++) {
      randomArr[i] = Math.random() * 0.5
    }
    ref.current.setAttribute('random', new THREE.BufferAttribute(randomArr, 1))

    for (let i = 0; i < ref.current.attributes.position.array.length; i++) {
      const pos = ref.current.attributes.position

      let px = pos.getX(i)
      let py = pos.getY(i)
      let pz = pos.getZ(i)

      let r = Math.sqrt(px * px + py * py + pz * pz)

      px += (Math.sin(py * r) * (3)) * (Math.random() * 50)
      py += (Math.cos(px * r) * (3)) * (Math.random() * 50)
      pz += (Math.sin(px * r) * (50)) * (Math.random() * 50)
      // py = Math.sin()
      // pz = Math.sin()


      pos.setXYZ(i, px, py, pz)
      pos.needUpdate = true
    }
  }, [])

  useFrame((state) => {
    renderRef.current.uniforms.uTime.value = state.clock.elapsedTime
  }
  )


  //return
  return (
    <points position={[0, 0, -50]}>
      <sphereBufferGeometry ref={ref} attach="geometry" args={[2, 150, 150]} />
      <shaderMaterial ref={renderRef} attach="material" {...shaderDat} />
    </points>

  )
}
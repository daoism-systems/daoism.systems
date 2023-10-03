import React, { useRef, useMemo, useEffect, useState } from 'react'
import { useGLTF, PerspectiveCamera, useAnimations, useScroll } from '@react-three/drei'
import { extend, useFrame, useLoader, useThree } from "@react-three/fiber"
import { TextureLoader } from 'three/src/loaders/TextureLoader'
import * as THREE from "three"
import { DoubleSide, Mesh, Scene } from 'three'


export default function CloudMesh({ nodesName, positionElem, rotationElem, scaleElem, positionElem2 }) {
  const renderRef = useRef()

  const fragmentShader = `
    #ifdef GL_ES
   precision mediump float;
  #endif
  
  uniform vec3 uColor4;
  void main(){
  
    float alpha = 1. - smoothstep(-0.2,0.5,length(gl_PointCoord - vec2(0.5)));
  
    vec3 finalColor = uColor4;
   
    ///////////////////////////////
    //If you want to change the speed of the color animation, change the 2. after the uTime variable 
    //////////////////////////////
    
    /*
   finalColor = mix(sin(vUv.x * 2. + uTime * 1.7)  + uColor1 * 3., sin(vUv.y * 10. + uTime * 2.) + uColor2 * 2., uColor3);
   //finalColor += sin(vUv.x * 5. + uTime * 0.5);
   finalColor += cos(vUv.x * 10. + uTime * 2.) + uColor1;
   finalColor += sin(vUv.y * 10. + uTime * 2.) + uColor2;
   finalColor += sin(vUv.y * 10. + uTime * 2.) + uColor3;
   */
   
   /*
   finalColor += sin(vUv.x * 6. + uTime * 2.) + uColor1;
   finalColor += sin(vUv.y * 1. + uTime * 2.) + uColor2;
   */


   gl_FragColor = vec4(finalColor, 0.01 * 7.);
   gl_FragColor = vec4(finalColor, alpha);

  
  }
`;
  const vertexShader = `

  void main()
  {
      //float noise = cnoise(vec3(position.xy * 0.4, uTime * 0.7));

      //float randomNoise = (noise * 0.5) * randoms;

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.);

      //Other size changing function
      //gl_PointSize = (10. + (50. * randomNoise)) * (20. / - mvPosition.z);

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
        uColor4: { value: new THREE.Color(0xDDDDDD) },
      },
      fragmentShader: fragmentShader,
      vertexShader: vertexShader,
      transparent: true,
      depthWrite: false,
    }),
    []
  )

  function getDistance(x1, y1, x2, y2) {
    let y = x2 - x1
    let x = y2 - y1

    return Math.sqrt(x * x + y * y)
  }

 const copyGeo = new THREE.BufferGeometry()
  copyGeo.copy(nodesName.geometry)


  function interactivePart(mousX, mousY, off) {
    const pos = nodesName.geometry.attributes.position;
    const copy = copyGeo.attributes.position;

    const mx = mousX + off
    const my = mousY
    const mz = 0

    for (var i = 0, l = pos.count; i < l; i++) {

      const baseX = copy.getX(i);
      const baseY = copy.getY(i);
      const baseZ = copy.getZ(i);

      let px = pos.getX(i);
      let py = pos.getY(i);
      let pz = pos.getZ(i);

      let dx = mx - px;
      let dy = my - py;
      let dz = mz - pz;

      const mouseDistance = getDistance(px, py, mx, my)
      let d = (dx = mx - px) * dx + (dy = my - py) * dy * (dz = mz - pz) * dz;
      const f = - 1 / d

      if (mouseDistance < 7) {

        if ((px < (baseX + 3)) && (px > (baseX - 3)) && (py < (baseY + 3)) && (py > (baseY - 3))) {

          const t = Math.atan2(dy, dx);
          px -= (f * Math.cos(t) * 0.1) * 0.3
          py -= (f * Math.sin(t) * 0.1) * 0.3

          pos.setXYZ(i, px, py, pz);
          pos.needsUpdate = true;
        }

      }

      px += (baseX - px) * Math.sin(0.04)
      py += (baseY - py) * Math.sin(0.04)
      pz += (baseZ - pz) * Math.sin(0.04)

      pos.setXYZ(i, px, py, pz)
      pos.needsUpdate = true

    }
  }

  let num1 = 0
  let num3

  const scroll = useScroll()

  useFrame((state) => {
    interactivePart(-50, -50, 0)
    num3 = num1 + (scroll.offset * 5)
  })

  return (
    <group>
      <mesh onPointerMove={(e) => {
        interactivePart(e.point.x, e.point.y, num3)
        // console.log(e.point.x)
        if(e.point.x > -2){
          num1 = -2
        }
        else{
          num1 = 0
        }
      }} 
        position={positionElem2} rotation={[0, 0, 0]} matrixAutoUpdate={true} layers={0}>
        <planeBufferGeometry attach="geometry" args={[30, 30]}/>
        <meshBasicMaterial attach="material" color={0xffffff} visible={false} side={DoubleSide} />
      </mesh>
      <points name={nodesName.name} layers={1} geometry={nodesName.geometry} material={nodesName.material} position={positionElem} scale={scaleElem} rotation={rotationElem}>
      <shaderMaterial ref={renderRef} attach="material" {...dataOctagon} />
      </points>
    </group>
  )
}
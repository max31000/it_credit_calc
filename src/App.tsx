import { MantineProvider, Stack } from '@mantine/core'
import '@mantine/core/styles.css'
import { Layout } from './components/layout/Layout'
import { Header } from './components/layout/Header'
import { ParamsSection } from './components/sections/ParamsSection'
import { SlipSection } from './components/sections/SlipSection'
import { InsightsSection } from './components/sections/InsightsSection'
import { ChartsSection } from './components/sections/ChartsSection'
import { MethodologySection } from './components/sections/MethodologySection'

function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <Layout>
        <Header />
        <Stack gap="xl">
          <ParamsSection />
          <SlipSection />
          <InsightsSection />
          <ChartsSection />
          <MethodologySection />
        </Stack>
      </Layout>
    </MantineProvider>
  )
}

export default App

import { MantineProvider, Stack } from '@mantine/core'
import '@mantine/core/styles.css'
import { Layout } from './components/layout/Layout'
import { Header } from './components/layout/Header'
import { MortgageParams } from './components/sections/MortgageParams'
import { SlipParams } from './components/sections/SlipParams'
import { SummaryCards } from './components/sections/SummaryCards'
import { NetWorthChart } from './components/sections/NetWorthChart'
import { DetailChart } from './components/sections/DetailChart'
import { SlipAnalysisChart } from './components/sections/SlipAnalysisChart'
import { InfoAccordion } from './components/sections/InfoAccordion'

function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <Layout>
        <Header />
        <Stack gap="xl">
          <MortgageParams />
          <SlipParams />
          <SummaryCards />
          <NetWorthChart />
          <DetailChart />
          <SlipAnalysisChart />
          <InfoAccordion />
        </Stack>
      </Layout>
    </MantineProvider>
  )
}

export default App
